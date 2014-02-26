/**
 * Module to render the consolidated files view. Reads addon configurations and
 * initializes an HGrid.
 */
this.Rubeus = (function($, HGrid, bootbox, window) {

    /////////////////////////
    // HGrid configuration //
    /////////////////////////

    // Custom folder icon indicating private component
    HGrid.Html.folderIconPrivate = '<img class="hg-icon hg-addon-icon" src="/static/img/hgrid/fatcowicons/folder_delete.png">';
    // Override Name column folder view to allow for extra widgets, e.g. github branch picker
    HGrid.Col.Name.folderView = function(item) {
        var icon, opening, cssClass;
        if (item.iconUrl) {
            // use item's icon based on filetype
            icon = '<img class="hg-addon-icon" src="' + item.iconUrl + '">';
            cssClass = '';
        } else {
            if (!item.permissions.view) {
                icon = HGrid.Html.folderIconPrivate;
                cssClass = 'hg-folder-private';
            } else {
                icon = HGrid.Html.folderIcon;
                cssClass = 'hg-folder-public';
            }
        }
        opening = '<span class="hg-folder-text ' + cssClass + '">';
        var closing = '</span>';
        html = [icon, opening, item.name, closing].join('');
        if(item.extra) {
            html += '<span class="hg-extras">' + item.extra + '</span>';
        }
        return html;
    };

    HGrid.Col.Name.showExpander = function(row) {
        return row.kind === HGrid.FOLDER && row.permissions.view;
    };

    HGrid.Col.Name.itemView = function(item) {
        var ext = item.name.split('.').pop().toLowerCase();
        var tooltipMarkup = genTooltipMarkup('View file');

        var nameElement = ['<span ' + tooltipMarkup + ' >', item.name, '</span>'].join('');

        var icon = Rubeus.Extensions.indexOf(ext) === -1 ?
                        HGrid.Html.fileIcon :
                        Rubeus.ExtensionSkeleton.replace('{{ext}}', ext);
        return [icon, nameElement].join('');
    };

    /**
     * Generate the markup necessary for adding a tooltip to an element.
     */
    function genTooltipMarkup(title, maxLength) {
        var max = maxLength || 30;
        // Truncate title if necessary
        var cleanTitle;
        if (title.length >= max) {
            cleanTitle = title.slice(0, max) + '...';
        } else {
            cleanTitle = title;
        }
        return ' title="' + cleanTitle + '" data-placement="right" ' +
                                'data-toggle="tooltip" ';
    }

    HGrid.Col.ActionButtons.itemView = function(item) {
        var downloadTip = genTooltipMarkup('Download ' + item.name);
        var buttonDefs = [{
              text: '<i class="icon-download-alt icon-white"' + downloadTip + '></i>',
              action: 'download',
              cssClass: 'btn btn-success btn-mini'
        }];
        if (item.permissions && item.permissions.edit) {
            var deleteTip = genTooltipMarkup('Delete ' + item.name);
            buttonDefs.push({
              text: '&nbsp;<i class="icon-remove"' + deleteTip + '></i>',
              action: 'delete',
              cssClass: 'btn btn-link btn-mini btn-delete'
            });
      }
      return ['<span class="rubeus-buttons">', HGrid.Fmt.buttons(buttonDefs),
                '</span><span data-status></span>'].join('');
    };

    /** Remove the 'Project: ' text from the beginning of a folder name. */
    function trimFolderName(name) {
        return name.slice(name.indexOf(':') + 1).trim();
    }

    HGrid.Col.ActionButtons.name = 'Actions';
    HGrid.Col.ActionButtons.width = 70;
    HGrid.Col.ActionButtons.folderView = function(row) {
        var buttonDefs = [];
        var tooltipMarkup = genTooltipMarkup('Upload');
        if (this.options.uploads && row.urls.upload &&
                (row.permissions && row.permissions.edit)) {
            buttonDefs.push({
                text: '<i class="icon-upload" ' + tooltipMarkup +  '></i>',
                action: 'upload',
                cssClass: 'btn btn-default btn-mini'
            });
        }
        if (buttonDefs) {
            return ['<span class="' + Rubeus.buttonContainer + '">', HGrid.Fmt.buttons(buttonDefs),
                '</span><span data-status></span>'].join('');
        }
        return '';
    };

    /**
     * Get the status message from the addon, if any.
     */
     function getStatusCfg(addon, whichStatus, extra) {
        if (addon && Rubeus.cfg[addon] && Rubeus.cfg[addon][whichStatus]) {
            if (typeof(Rubeus.cfg[addon][whichStatus]) === 'function') {
                return Rubeus.cfg[addon][whichStatus](extra);
            }
            return Rubeus.cfg[addon][whichStatus];
        }
        if (typeof(default_status[whichStatus]) === 'function') {
            return default_status[whichStatus](extra);
        }
        return default_status[whichStatus];
     }

     HGrid.prototype.showButtons = function(row) {
        var $rowElem = $(this.getRowElement(row.id));
        var $buttons = $rowElem.find('.' + Rubeus.buttonContainer);
        $buttons.show();
        return this;
     };

     HGrid.prototype.hideButtons = function(row) {
        var $rowElem = $(this.getRowElement(row.id));
        var $buttons = $rowElem.find('.rubeus-buttons');
        $buttons.hide();
        return this;
     };

    /**
     * Changes the html in the status column.
     */
    HGrid.prototype.changeStatus = function(row, html, extra, fadeAfter, callback) {
        var $rowElem = $(this.getRowElement(row.id));
        var $status = $rowElem.find(Rubeus.statusSelector);
        this.hideButtons(row);
        $status.html(getStatusCfg(row.addon, html, extra));
        if (fadeAfter) {
            setTimeout(function() {
                $status.fadeOut('slow', function() {callback(row);});
            }, fadeAfter);
        }
        return $status;
    };

    var default_status = {
        FETCH_SUCCESS: '',
        FETCH_START: '<span class="text-muted">Fetching contents. . .</span>',
        FETCH_ERROR: '<span class="text-info">Could not retrieve data. Please refresh the page and try again.</span>',

        UPLOAD_SUCCESS: '<span class="text-success">Successfully uploaded</span>',
        NO_CHANGES: '<span class="text-info">No changes made from previous version. Removing duplicate row. . .</span>',
        UPDATED: '<span class="text-info">Existing file updated. Removing duplicate row. . .</span>',
        DELETING: function(row) {
            return '<span class="text-muted">Deleting "' + row.name + '"</span>';
        },
        DELETED: function(row) {
            return '<span class="text-warning">Successfully deleted "' + row.name + '"</span>';
        },
        UPLOAD_ERROR: function(msg) {
            return '<span class="text-danger">' + msg + '</span>';
        },
        UPLOAD_PROGRESS: function(progress) {
            return '<span class="text-info">' + Math.floor(progress) + '%</span>';
        }
    };

    var statusType = {
        FETCH_SUCCESS: 'FETCH_SUCCESS',
        FETCH_START: 'FETCH_START',
        FETCH_ERROR: 'FETCH_ERROR',
        UPLOAD_SUCCESS: 'UPLOAD_SUCCESS',
        NO_CHANGES: 'NO_CHANGES',
        UPDATED: 'UPDATED',
        DELETING: 'DELETING',
        DELETED: 'DELETED',
        UPLOAD_ERROR: 'UPLOAD_ERROR',
        UPLOAD_PROGRESS: 'UPLOAD_PROGRESS'
    };

    Rubeus.Status = statusType;
    Rubeus.buttonContainer = 'rubeus-buttons';
    Rubeus.statusSelector = '[data-status]';
    ////////////////////////
    // Listener callbacks //
    ////////////////////////

    function onConfirmDelete(row, grid) {
        if (row) {
            var rowCopy = $.extend({}, row);
            // Show "Deleting..." message in parent folder's status column
            var parent = grid.getByID(rowCopy.parentID);
            grid.changeStatus(row, statusType.DELETING, rowCopy);
            grid.deleteFile(row, {
                error: function() {
                    // TODO: This text should be configurable by addon devs
                    bootbox.error('Could not delete ' + row.name + '. Please try again later.');
                },
                success: function() {
                    grid.getDataView().updateItem(parent.id, parent);
                    // Show 'Successfully deleted' in folder's status column
                    grid.changeStatus(row, statusType.DELETED, rowCopy);
                    setTimeout(function(){
                        grid.removeItem(rowCopy.id);
                    }, 1000);
                }
            });
        }
    }

    function onClickName(evt, row, grid) {
        if (row) {
            var viewUrl = grid.getByID(row.id).urls.view;
            if (viewUrl) {
                window.location.href = viewUrl;
            }
            if (row.kind === HGrid.FOLDER && row.depth !== 0) {
                grid.toggleCollapse(row);
            }
        }
    }

    ///////////////////
    // HGrid options //
    ///////////////////

    // OSF-specific HGrid options common to all addons
    baseOptions = {
        /*jshint unused: false */
        columns: [
            HGrid.Col.Name,
            HGrid.Col.ActionButtons
        ],
        width: '100%',
        height: 900,
        fetchUrl: function(row) {
            return row.urls.fetch || null;
        },
        fetchSuccess: function(data, row) {
            updateTooltips();
            this.changeStatus(row, statusType.FETCH_SUCCESS);
            this.showButtons(row);
        },
        fetchError: function(error, row) {
            this.changeStatus(row, statusType.FETCH_ERROR);
        },
        fetchStart: function(row) {
            this.changeStatus(row, statusType.FETCH_START);
        },
        uploadProgress: function(file, progress, bytesSent, row) {
            if (progress === 100) {
                var sendingTo = row.addonFullname || 'external service...';
                this.changeStatus(row, ['Sending to ', sendingTo, '. Please wait...'].join(''));
            } else{
                this.changeStatus(row, statusType.UPLOAD_PROGRESS, progress);
            }
        },
        downloadUrl: function(row) {
            return row.urls.download;
        },
        deleteUrl: function(row) {
            return row.urls.delete;
        },
        onClickDelete: function(evt, row) {
            var self = this;
            var $elem = $(evt.target);
            bootbox.confirm({
                message: '<strong>NOTE</strong>: This action is irreversible.',
                title: 'Delete <em>' + row.name + '</em>?',
                callback: function(result) {
                    if (result) {
                        onConfirmDelete(row, self);
                    }
                }
            });
            return this;
        },
        canUpload: function(folder) {
            return folder.permissions.edit;
        },
        deleteMethod: 'delete',
        uploads: true,
        maxFilesize: function(row) {
            return row.accept? (row.accept.maxSize || 128) : 128;
        },
        // acceptedFiles: function(row) {
        //     return row.accept.acceptedFiles || null;
        // },
        uploadUrl: function(row) {
            var cfgOption = resolveCfgOption.call(this, row, 'uploadUrl', [row]);
            return cfgOption || row.urls.upload;
        },

        uploadAdded: function(file, row, folder) {
            // Need to set the added row's addon for other callbacks to work
            var parent = this.getByID(row.parentID);
            row.addon = parent.addon;
            // expand the folder
            this.expandItem(folder);
            var cfgOption = resolveCfgOption.call(this, row, 'uploadAdded', [file, row]);
            return cfgOption || null;
        },
        uploadMethod: function(row) {
            var cfgOption = resolveCfgOption.call(this, row, 'uploadMethod', [row]);
            return cfgOption || 'post';
        },
        uploadSending: function(file, row, xhr, formData) {
            var cfgOption = resolveCfgOption.call(this, row, 'uploadSending', [file, row, xhr, formData]);
            return cfgOption || null;
        },
        uploadError: function(file, message, item, folder) {
            // FIXME: can't use change status, because the folder item is updated
            // on complete, which replaces the html row element
            // for now, use bootbox
            bootbox.alert(message);
        },
        uploadSuccess: function(file, row, data) {
            // If file hasn't changed, remove the duplicate item
            // TODO: shows status in parent for now because the duplicate item
            // is removed and we don't have access to the original row for the file
            var self = this;
            if (data.actionTaken === null) {
                self.changeStatus(row, statusType.NO_CHANGES);
                setTimeout(function() {
                    $(self.getRowElement(row)).fadeOut(500, function() {
                        self.removeItem(row.id);
                    });
                }, 2000);
            } else if (data.actionTaken === 'file_updated') {
                self.changeStatus(row, statusType.UPDATED);
                setTimeout(function() {
                    $(self.getRowElement(row)).fadeOut(500, function() {
                        self.removeItem(row.id);
                    });
                }, 2000);
            } else{
                // Update the row with the returned server data
                // This is necessary for the download and delete button to work.
                $.extend(row, data);
                this.updateItem(row);
                this.changeStatus(row, statusType.UPLOAD_SUCCESS, null, 2000,
                    function(row) {
                        self.showButtons(row);
                    });
            }
            var cfgOption = resolveCfgOption.call(this, row, 'uploadSuccess', [file, row, data]);
            return cfgOption || null;
        },
        // TODO: Set parallel uploads to 1 for now until git collision issue is fixed
        dropzoneOptions: {
            parallelUploads: 1
        },
        listeners: [
            // Go to file's detail page if name is clicked
            {
                on: 'click',
                selector: '.' + HGrid.Html.nameClass,
                callback: onClickName
            }
        ],
        init: function() {
            var self = this;
            // Expand all first level items
            this.getData().forEach(function(item) {
                self.expandItem(item);
            });
            updateTooltips();
        },
        // Add a red highlight when user drags over a folder they don't have
        // permission to upload to.
        onDragover: function(evt, row) {
            if (row && !row.permissions.view) {
                this.addHighlight(row, 'highlight-denied');
            }
        },
        onDragleave: function(evt, row) {
            this.removeHighlight('highlight-denied');
        },
        uploadDenied: function(evt, row) {
            this.removeHighlight('highlight-denied');
        }
    };

    function updateTooltips() {
        $('[data-toggle="tooltip"]').tooltip({animation: false});
    }

    ///////////////////////
    // Rubeus Public API //
    ///////////////////////

    function Rubeus(selector, options) {
        this.selector = selector;
        this.options = $.extend({}, baseOptions, options);
        this.grid = null; // Set by _initGrid
        this.init();
    }
    // Addon config registry
    Rubeus.cfg = {};

    function getCfg(row, key) {
        if (row && row.addon && Rubeus.cfg[row.addon]) {
            return Rubeus.cfg[row.addon][key];
        }
        return undefined;
    }

    // Gets a Rubeus config option if it is defined by an addon dev.
    // Calls it with `args` if it's a function otherwise returns the value.
    // If the config option is not defined, return null
    function resolveCfgOption(row, option, args) {
        var self = this;
        var prop = getCfg(row, option);
        if (prop) {
            return typeof prop === 'function' ? prop.apply(self, args) : prop;
        } else {
            return null;
        }
    }

    Rubeus.prototype = {
        constructor: Rubeus,
        init: function() {
            var self = this;
            this._registerListeners()
                ._initGrid();
            // Show alert if user tries to leave page before upload is finished.
            $(window).on('beforeunload', function() {
                if (self.grid.dropzone && self.grid.dropzone.getUploadingFiles().length) {
                    return 'Uploads(s) still in progress. Are you sure you want to leave this page?';
                }
            });
        },
        _registerListeners: function() {
            for (var addon in Rubeus.cfg) {
                var listeners = Rubeus.cfg[addon].listeners;
                if (listeners) {
                    // Add each listener to the hgrid options
                    for (var i = 0, listener; listener = listeners[i]; i++) {
                        this.options.listeners.push(listener);
                    }
                }
            }
            return this;
        },
        // Create the Hgrid once all addons have been configured
        _initGrid: function() {
            this.grid = new HGrid(this.selector, this.options);
            return this;
        }
    };

    ///////////////////
    // Icon "Plugin" //
    ///////////////////

    Rubeus.Extensions = ['3gp', '7z', 'ace', 'ai', 'aif', 'aiff', 'amr', 'asf', 'asx', 'bat', 'bin', 'bmp', 'bup',
        'cab', 'cbr', 'cda', 'cdl', 'cdr', 'chm', 'dat', 'divx', 'dll', 'dmg', 'doc', 'docx', 'dss', 'dvf', 'dwg',
        'eml', 'eps', 'exe', 'fla', 'flv', 'gif', 'gz', 'hqx', 'htm', 'html', 'ifo', 'indd', 'iso', 'jar',
        'jpeg', 'jpg', 'lnk', 'log', 'm4a', 'm4b', 'm4p', 'm4v', 'mcd', 'mdb', 'mid', 'mov', 'mp2', 'mp3', 'mp4',
        'mpeg', 'mpg', 'msi', 'mswmm', 'ogg', 'pdf', 'png', 'pps', 'ps', 'psd', 'pst', 'ptb', 'pub', 'qbb',
        'qbw', 'qxd', 'ram', 'rar', 'rm', 'rmvb', 'rtf', 'sea', 'ses', 'sit', 'sitx', 'ss', 'swf', 'tgz', 'thm',
        'tif', 'tmp', 'torrent', 'ttf', 'txt', 'vcd', 'vob', 'wav', 'wma', 'wmv', 'wps', 'xls', 'xpi', 'zip'];

    Rubeus.ExtensionSkeleton = '<img class="hg-icon" src="/static\/img\/hgrid\/fatcowicons\/file_extension_{{ext}}.png">';

    return Rubeus;

})(jQuery, HGrid, bootbox, window);