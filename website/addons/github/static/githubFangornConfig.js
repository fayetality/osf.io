/**
 * Github FileBrowser configuration module.
 */
var m = require('mithril');

var Fangorn = require('fangorn');
var waterbutler = require('waterbutler');

var branch = undefined;


function _uploadUrl(item, file) {
    return waterbutler.buildTreeBeardUpload(item, file, {branch: branch});
}


// Define Fangorn Button Actions
function _fangornActionColumn (item, col){
    var self = this;
    var buttons = [];

    function _removeEvent (event, item, col) {
        try {
            event.stopPropagation();
        } catch (e) {
            window.event.cancelBubble = true;
        }
        var tb = this;
        item.notify.update('Deleting...', 'deleting', undefined, 3000);
        if (item.data.permissions.edit) {
            // delete from server, if successful delete from view
            $.ajax({
                url: waterbutler.buildTreeBeardDelete(item, {branch: branch, sha: item.data.extra.fileSha}),
                type : 'DELETE'
            })
            .done(function(data) {
                // delete view
                tb.deleteNode(item.parentID, item.id);
                window.console.log('Delete success: ', data);
            })
            .fail(function(data){
                window.console.log('Delete failed: ', data);
                item.notify.update('Delete failed.', 'danger', undefined, 3000);
            });
        }
    }

    function _downloadEvent (event, item, col) {
        event.stopPropagation();
        console.log('Download Event triggered', this, event, item, col);
        window.location = waterbutler.buildTreeBeardDownload(item, {ref: item.data.extra.fileSha});
    }

    // Download Zip File
    if (item.kind === 'folder') {
        if (item.data.permissions.edit) {
            buttons.push({
                'name' : '',
                'icon' : 'icon-upload-alt',
                'css' : 'fangorn-clickable btn btn-default btn-xs',
                'onclick' : Fangorn.ButtonEvents._uploadEvent
            });
        }

        if (item.data.addonFullname) {
            buttons.push(
                {
                    'name' : '',
                    'icon' : 'icon-download-alt',
                    'css' : 'fangorn-clickable btn btn-info btn-xs',
                    'onclick' : function(){window.location = item.data.urls.zip;}
                },
                {
                    'name' : '',
                    'icon' : 'icon-external-link',
                    'css' : 'btn btn-primary btn-xs',
                    'onclick' : function(){window.location = item.data.urls.repo;}//GO TO EXTERNAL PAGE
                }
            );
        }
    } else if (item.kind === 'file') {
        buttons.push({
            'name' : '',
            'icon' : 'icon-download-alt',
            'css' : 'btn btn-info btn-xs',
            'onclick' : _downloadEvent
        });

        if (item.data.permissions.edit) {
            buttons.push({
                'name' : '',
                'icon' : 'icon-remove',
                'css' : 'm-l-lg text-danger fg-hover-hide',
                'style' : 'display:none',
                'onclick' : _removeEvent
            });
        }
    }

    return buttons.map(function(btn){
        return m('span', { 'data-col' : item.id }, [
            m('i', {
                'class' : btn.css,
                style : btn.style,
                'onclick' : function(event){ btn.onclick.call(self, event, item, col); }
            }, [ m('span', { 'class' : btn.icon}, btn.name) ])
        ]);
    });
}

function changeBranch(item, ref){
    branch = ref;
    this.updateFolder(null, item);
}

function _resolveLazyLoad(item) {
    return waterbutler.buildTreeBeardMetadata(item, {ref: branch});
}

function _fangornGithubTitle(item, col)  {
    var tb = this;
    var branchArray = [];
    if (item.data.branches) {
        branch = item.data.defaultBranch;
        for (var i = 0; i < item.data.branches.length; i++) {
            var selected = item.data.branches[i] === item.data.defaultBranch ? 'selected' : '';
            branchArray.push(m('option', {selected : selected, value:item.data.branches[i]}, item.data.branches[i]));
        }
    }

    if (item.data.addonFullname) {
        return m('span',[
            m('github-name', item.data.name + ' '),
            m('span',[
                m('select[name=branch-selector]', { onchange: function(ev) { changeBranch.call(tb, item, ev.target.value ) } }, branchArray)
            ])
        ]);
    } else {
        return m('span',[
            m('github-name', {
                onclick: function() {
                    var params = $.param(
                        $.extend(
                          {
                              provider: item.data.provider,
                              path: item.data.path.substring(1),
                              branch: branch
                          },
                          item.data.extra || {}
                        )
                    );
                    window.location = nodeApiUrl + 'waterbutler/files/?' + params;
                }}, item.data.name)
        ]);
    }

}

function _fangornColumns (item) {
    var columns = [];
    columns.push({
        data : 'name',
        folderIcons : true,
        filter: true,
        custom : _fangornGithubTitle
    });

    if(this.options.placement === 'project-files') {
        columns.push(
            {
            css : 'action-col',
            filter : false,
            custom : _fangornActionColumn
        },
        {
            data  : 'downloads',
            filter : false,
            css : ''
        });
    }
    return columns;
}

function _fangornFolderIcons(item){
    if(item.data.iconUrl){
        return m('img',{src:item.data.iconUrl, style:{width:'16px', height:'auto'}}, ' ');
    }
    return undefined;
}

function _fangornUploadComplete(item){
    console.log('upload complete', this, item);
    var index = this.returnIndex(item.id);
}

// Register configuration
Fangorn.config.github = {
    // Handle changing the branch select
    uploadUrl: _uploadUrl,
    lazyload: _resolveLazyLoad,
    resolveRows: _fangornColumns,
    folderIcon: _fangornFolderIcons,
    onUploadComplete : _fangornUploadComplete,
};
