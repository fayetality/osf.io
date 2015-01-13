# encoding: utf-8

import httplib
import logging

from flask import request

from framework.auth import Auth
from framework.flask import redirect
from framework.exceptions import HTTPError
from framework.analytics import update_counter
from framework.auth.decorators import must_be_signed

from website.models import User
from website.project.decorators import (
    must_be_contributor_or_public,
    must_not_be_registration, must_have_addon,
)
from website.util import rubeus
from website.project.utils import serialize_node
from website.addons.base.views import check_file_guid

from website.addons.osfstorage import model
from website.addons.osfstorage import utils
from website.addons.osfstorage import errors
from website.addons.osfstorage import settings as osf_storage_settings


logger = logging.getLogger(__name__)

MEGABYTE = 1024 * 1024


def make_error(code, message_short=None, message_long=None):
    data = {}
    if message_short:
        data['message_short'] = message_short
    if message_long:
        data['message_long'] = message_long
    return HTTPError(code, data=data)


def get_record_or_404(path, node_addon):
    record = model.OsfStorageFileRecord.find_by_path(path, node_addon)
    if record is not None:
        return record
    raise HTTPError(httplib.NOT_FOUND)


@must_be_signed
@must_have_addon('osfstorage', 'node')
def osf_storage_crud_hook_get(node_addon, payload, **kwargs):
    # TODO: Check HMAC signature
    try:
        path = payload['path']
    except KeyError:
        raise HTTPError(httplib.BAD_REQUEST)

    version_idx = request.args.get('version')
    _, version, record = get_version(path, node_addon, version_idx)
    return {
        'data': {
            'path': version.location_hash,
        },
        'settings': {
            osf_storage_settings.WATERBUTLER_RESOURCE: version.location[osf_storage_settings.WATERBUTLER_RESOURCE],
        },
    }


def osf_storage_crud_prepare(node_addon, payload):
    # TODO: Verify HMAC signature
    try:
        auth = payload['auth']
        settings = payload['settings']
        metadata = payload['metadata']
        hashes = payload['hashes']
        worker = payload['worker']
        path = payload['path'].strip('/')
    except KeyError:
        raise HTTPError(httplib.BAD_REQUEST)
    user = User.load(auth.get('id'))
    if user is None:
        raise HTTPError(httplib.BAD_REQUEST)
    location = settings
    location.update({
        'object': metadata['name'],
        'service': metadata['provider'],
    })
    # TODO: Migrate existing worker host and URL
    location.update(worker)
    metadata.update(hashes)
    return path, user, location, metadata


@must_be_signed
@must_have_addon('osfstorage', 'node')
def osf_storage_crud_hook_post(node_addon, payload, **kwargs):
    path, user, location, metadata = osf_storage_crud_prepare(node_addon, payload)
    record, created = model.OsfStorageFileRecord.get_or_create(path, node_addon)
    version = record.create_version(user, location, metadata)

    code = httplib.CREATED if created else httplib.OK

    return {
        'status': 'success',
        'version_id': version._id,
    }, code


@must_be_signed
@must_have_addon('osfstorage', 'node')
def osf_storage_crud_hook_put(node_addon, payload, **kwargs):
    try:
        version_id = payload['version_id']
        metadata = payload['metadata']
    except KeyError:
        raise HTTPError(httplib.BAD_REQUEST)

    version = model.OsfStorageFileVersion.load(version_id)
    if version is None:
        raise HTTPError(httplib.BAD_REQUEST)
    version.update_metadata(metadata)
    return {'status': 'success'}


def parse_version_specifier(version_str):
    """
    :raise: `InvalidVersionError` if version specifier cannot be parsed
    """
    try:
        version_idx = int(version_str)
    except (TypeError, ValueError):
        raise errors.InvalidVersionError
    if version_idx < 1:
        raise errors.InvalidVersionError
    return version_idx


def get_version_helper(file_record, version_str):
    """
    :return: Tuple of (version_index, file_version); note that index is one-based
    :raise: `HTTPError` if version specifier is invalid or version not found
    """
    if version_str is None:
        return (
            len(file_record.versions),
            file_record.versions[-1],
        )
    try:
        version_idx = parse_version_specifier(version_str)
    except errors.InvalidVersionError:
        raise make_error(httplib.BAD_REQUEST, 'Invalid version')
    try:
        return version_idx, file_record.versions[version_idx - 1]
    except IndexError:
        raise HTTPError(httplib.NOT_FOUND)


def get_version(path, node_settings, version_str, throw=True):
    """Resolve version from request arguments.

    :param str path: Path to file
    :param node_settings: Node settings record
    :param str version_str: Version from query string
    :param bool throw: Throw `HTTPError` if version is incomplete
    :return: Tuple of (<one-based version index>, <file version>, <file record>)
    """
    record = model.OsfStorageFileRecord.find_by_path(path, node_settings)
    if record is None:
        raise HTTPError(httplib.NOT_FOUND)
    if record.is_deleted:
        raise HTTPError(httplib.GONE)
    version_idx, file_version = get_version_helper(record, version_str)
    return version_idx, file_version, record


def serialize_file(idx, version, record, path, node):
    """Serialize data used to render a file.
    """
    rendered = utils.render_file(idx, version, record)
    return {
        'file_name': record.name,
        'file_revision': 'Version {0}'.format(idx),
        'file_path': '/' + record.path,
        'rendered': rendered,
        'files_url': node.web_url_for('collect_file_trees'),
        'download_url': node.web_url_for('osf_storage_view_file', path=path, action='download'),
        # 'delete_url': node.api_url_for('osf_storage_delete_file', path=path),
        'revisions_url': node.api_url_for(
            'osf_storage_get_revisions',
            path=path,
        ),
        'render_url': node.api_url_for(
            'osf_storage_render_file',
            path=path,
            version=idx,
        ),
    }


def download_file(path, node_addon, version_query):
    mode = request.args.get('mode')
    idx, version, record = get_version(path, node_addon, version_query)
    url = utils.get_download_url(idx, version, record)
    if mode != 'render':
        update_analytics(node_addon.owner, path, idx)
    return redirect(url)


def view_file(auth, path, node_addon, version_query):
    node = node_addon.owner
    idx, version, record = get_version(path, node_addon, version_query, throw=False)
    file_obj = model.OsfStorageGuidFile.get_or_create(node=node, path=path)
    redirect_url = check_file_guid(file_obj)
    if redirect_url:
        return redirect(redirect_url)
    ret = serialize_file(idx, version, record, path, node)
    ret.update(serialize_node(node, auth, primary=True))
    return ret


@must_be_contributor_or_public
@must_have_addon('osfstorage', 'node')
def osf_storage_view_file(auth, path, node_addon, **kwargs):
    action = request.args.get('action', 'view')
    version_idx = request.args.get('version')
    if action == 'download':
        return download_file(path, node_addon, version_idx)
    if action == 'view':
        return view_file(auth, path, node_addon, version_idx)
    raise HTTPError(httplib.BAD_REQUEST)


def update_analytics(node, path, version_idx):
    """
    :param Node node: Root node to update
    :param str path: Path to file
    :param int version_idx: One-based version index
    """
    update_counter(u'download:{0}:{1}'.format(node._id, path))
    update_counter(u'download:{0}:{1}:{2}'.format(node._id, path, version_idx))


@must_be_contributor_or_public
@must_have_addon('osfstorage', 'node')
def osf_storage_render_file(path, node_addon, **kwargs):
    version = request.args.get('version')
    idx, version, record = get_version(path, node_addon, version)
    return utils.render_file(idx, version, record)


@must_be_signed
@must_not_be_registration
@must_have_addon('osfstorage', 'node')
def osf_storage_crud_hook_delete(payload, node_addon, **kwargs):
    file_record = model.OsfStorageFileRecord.find_by_path(payload.get('path'), node_addon)

    if file_record is None:
        raise HTTPError(httplib.NOT_FOUND)

    try:
        auth = Auth(User.load(payload['auth'].get('id')))
        if not auth:
            raise HTTPError(httplib.BAD_REQUEST)

        file_record.delete(auth)
    except errors.DeleteError:
        raise HTTPError(httplib.NOT_FOUND)

    file_record.save()
    return {'status': 'success'}


@must_be_signed
@must_have_addon('osfstorage', 'node')
def osf_storage_hgrid_contents(node_addon, payload, **kwargs):
    path = payload.get('path', '')
    file_tree = model.OsfStorageFileTree.find_by_path(path, node_addon)
    if file_tree is None:
        if path == '':
            return []
        raise HTTPError(httplib.NOT_FOUND)
    node = node_addon.owner
    return [
        utils.serialize_metadata_hgrid(item, node)
        for item in list(file_tree.children)
        if item.touch() and not item.is_deleted
    ]


def osf_storage_root(node_settings, auth, **kwargs):
    """Build HGrid JSON for root node. Note: include node URLs for client-side
    URL creation for uploaded files.
    """
    node = node_settings.owner
    root = rubeus.build_addon_root(
        node_settings=node_settings,
        name='',
        permissions=auth,
        nodeUrl=node.url,
        nodeApiUrl=node.api_url,
    )
    return [root]


@must_be_contributor_or_public
@must_have_addon('osfstorage', 'node')
def osf_storage_get_revisions(path, node_addon, **kwargs):
    node = node_addon.owner
    page = request.args.get('page', 0)
    try:
        page = int(page)
    except (TypeError, ValueError):
        raise HTTPError(httplib.BAD_REQUEST)
    record = model.OsfStorageFileRecord.find_by_path(path, node_addon)
    if record is None:
        raise HTTPError(httplib.NOT_FOUND)
    indices, versions, more = record.get_versions(
        page,
        size=osf_storage_settings.REVISIONS_PAGE_SIZE,
    )
    return {
        'revisions': [
            utils.serialize_revision(node, record, versions[idx], indices[idx])
            for idx in range(len(versions))
        ],
        'more': more,
    }


@must_be_contributor_or_public
@must_have_addon('osfstorage', 'node')
def osf_storage_view_file_legacy(fid, node_addon, **kwargs):
    node = node_addon.owner
    return redirect(
        node.web_url_for(
            'osf_storage_view_file',
            path=fid,
        ),
        code=httplib.MOVED_PERMANENTLY,
    )


@must_be_contributor_or_public
@must_have_addon('osfstorage', 'node')
def osf_storage_download_file_legacy(fid, node_addon, **kwargs):
    node = node_addon.owner
    version = kwargs.get('vid', None)
    return redirect(
        node.web_url_for(
            'osf_storage_view_file',
            path=fid,
            version=version,
            action='download',
        ),
        code=httplib.MOVED_PERMANENTLY,
    )
