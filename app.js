var http = require('http');
var https = require('https');
var path = require('path');
var fs = require('fs');
var gitHubWebhookHandler = require('github-webhook-handler');
var requestIp = require('request-ip');
var streamifier = require('streamifier');
var mkdirp = require('mkdirp');
var ip = require('ip');
var Ssh2 = require('ssh2').Client;
var error = require('./error');
var settings = require('./.settings.js');

var notificationRecipients = [];

/// Get the GitHub file using HTTP once notified to do so. 
function getFile(fileName, localPath, remotePath, sshClient, sftpPath) {
    var binaryFile = false;
    if (localPath === undefined && remotePath === undefined) { throw new Error('localPath or remotePath must be defined'); }
    if (['.jpg', 'jpeg', '.png', '.gif', '.mp3', '.mp4'].indexOf(fileName.substr(fileName.length - 4).toLowerCase()) > -1) {
        binaryFile = true;
    }
    /// message to tell we are about to get the file
    errorHandler('getting ' + fileName, 'getFile', 'info');
    https.get(remotePath + '/' + fileName, function(res) {
        /// check res status
        if (res.statusCode !== 200 && res.statusCode !== 304) {
            errorHandler('status ' + res.statusCode + '. message: ' + res.statusMessage, 'getFile2' )
            return;
        }
        var body = '';
        if (binaryFile) {
            res.setEncoding('binary');
            body = [];
        }
        res.on('data', function(chunk) {
            if (binaryFile) {
                body.push(new Buffer(chunk, 'binary'));
            } else {
                body+= chunk;
            }
        });
        
        res.on('end', function() {
            if (binaryFile) {
                body = Buffer.concat(body);
            }
            if (localPath) {
                /// make the directory if it doesn't exist
                mkdirp(path.dirname(path.join(localPath, fileName)), function (err) {
                    if (err) { errorHandler(err, 'push4'); return; }
                    if (binaryFile) {
                       fs.writeFile(path.join(localPath, fileName), body, 'binary', function(err) {
                            if (err) { errorHandler(err, 'push2'); return; }
                                errorHandler(path.join(localPath, fileName) + ' written to the local file system', 'file sent', 'info');
                            });
                    } else {
                        fs.writeFile(path.join(localPath, fileName), body, function(err) {
                            if (err) { errorHandler(err, 'push2'); return; }
                            errorHandler(path.join(localPath, fileName) + ' written to the local file system', 'file sent', 'info');
                        });
                    }
                });
            }

            /// Only write if the remote path is set
            if (sftpPath !== undefined) {
                try {
                    sshClient.sftp(function (err, sftp) {
                        if ( err ) {
                            errorHandler(err, 'getFile.sshClient.sftp');
                            return;
                        }
                        sftp.mkdirParent = function(dirPath, mode, callback) {
                            var dirPathCurr = '', dirTree = dirPath.split('\\');
                            dirTree.shift();

                            function mkdir(err) {
                                var dir = dirTree.shift();
                                dirPathCurr += dir + '/';
                                if (dirTree.length > 0) {
                                    sftp.mkdir(dirPathCurr, mode, mkdir);
                                } else {
                                    sftp.mkdir(dirPathCurr, mode, callback);
                                }
                                
                            }
                            mkdir();
                        }
                        sftp.mkdirParent(path.dirname(path.join(sftpPath, fileName)), undefined, function (err) {
                            if (err) { errorHandler(err, 'push5'); return; }
                            // upload file
                            var readStream = streamifier.createReadStream( body);
                            //console.log(readStream._object.length);
                            var writeStream = sftp.createWriteStream(path.join(sftpPath, fileName), {encoding: 'binary'});

                            // what to do when transfer finishes
                            writeStream.on(
                                'close',
                                function () {
                                    errorHandler(path.join(sftpPath, fileName) + ' written to ' + sshClient.config.host, 'file sent', 'info');
                                    sftp.end();
                                    sshClient.end();
                                }
                            );

                            writeStream.on(
                                'error',
                                function (err) {
                                    errorHandler(err, 'push7'); 
                                    sftp.end();
                                    sshClient.end();
                                    return;
                                }
                            );
             
                            // initiate transfer of file, both of these work
                            //readStream.pipe( writeStream );
                            writeStream.write(body);
                            writeStream.end();
                        });
                    });
                } catch (err) {
                    errorHandler(err, 'push3');
                }
            }
        });
        
    })
    .on('error', function(err) {
        if (err) { errorHandler(err, 'push1'); return; }
    });
}

/**
 * Remove a file from the local file system and the sftp server
 * @param {string} fileName - the name of the file to be deleted
 * @param {string} localPath - path on hte local machine if hte file will be stored there
 * @param {object} sshClient - ssh2 client object for SSH connection
 * @param {string} sftpPath - path on the ssh server where the file will be uploaded to.
 * @param {Requester~requestCallback} callback - returns an error or undefined
 **/
function deleteFile(fileName, localPath, sshClient, sftpPath) {
    if (localPath) {
        fs.unlink(path.join(localPath, fileName), function(err) {
            if (err) { errorHandler(err, 'deleteFile 1'); return; }
            errorHandler(path.join(localPath, fileName) + ' deleted from the local file system', 'file delete', 'info');
        });
    }
    if (sftpPath) {
        sshClient.sftp(function (err, sftp) {
            if ( err ) { errorHandler(err, 'deleteFile 2'); return; }
            sftp.unlink(path.dirname(path.join(sftpPath, fileName)), function (err) {
                if (err) { errorHandler(err, 'deleteFile 3'); return; }
                errorHandler(path.join(localPath, fileName) + ' deleted from ' + sshClient.config.host, 'file delete', 'info');
            });
        });
    }
}

/**
 * Set up the listener for web hooks.
 * @param {string} localPath - path on hte local machine if hte file will be stored there
 * @param {string} hookName - the name setup in GitHub
 * @param {string} secret - password for GitHub file check
 * @param {object} sshSettings - ssh server settings like host and port.
 * @param {string} sftpPath - ssh server path to store the files
 **/
function addHookHandler(localPath, hookName, secret, sshSettings, sftpPath) {
    var handler = gitHubWebhookHandler({ path: hookName, secret: secret });
    handler.on('push', function (event) {
        var added = event.payload.head_commit.added,
            removed = event.payload.head_commit.removed,
            modified = event.payload.head_commit.modified,
            //remotePath = event.payload.head_commit.url            
            remotePath =  'https://raw.githubusercontent.com/' + event.payload.repository.full_name + '/master',
            //remotePath = 'http://localhost:8081/' + event.payload.repository.full_name,
            j;
        if (sftpPath) {
            var ssh2 = new Ssh2();
            ssh2.connect(sshSettings);
            ssh2.on('error', function(err) {
                errorHandler(err, 'sshClient');
            });
            ssh2.on('ready', function() {
                for (j = 0; j < modified.length; j++) {
                    getFile(modified[j], localPath, remotePath, ssh2, sftpPath);
                }
                
                for (j = 0; j < added.length; j++) {
                    getFile(added[j], localPath, remotePath, ssh2, sftpPath);
                }
                for (j = 0; j < removed.length; j++) {
                    deleteFile(removed[j], localPath, ssh2, sftpPath);
                }
            });
        } else {   
            for (j = 0; j < modified.length; j++) {
                getFile(modified[j], localPath, remotePath);
            }
            for (j = 0; j < added.length; j++) {
                getFile(added[j], localPath, remotePath);
            }
            for (j = 0; j < removed.length; j++) {
                deleteFile(removed[j], localPath);
            }
        }

        errorHandler('Received a push event for '+ event.payload.repository.name, 'addHookHandler', 'info');
        /// get https://github.com/seethespark/i-flicks/archive/master.zip
    });
    handler.on('error', function (err) {
        errorHandler(err, 'addHookHandler.1');
    });
    return handler;
}

for (var i = 0; i < settings.hooks.length; i++) {
    var localPath = settings.hooks[i].localPath, 
        sshSettings = settings.hooks[i].ssh,
        sftpPath = settings.hooks[i].sftpPath,
        name = settings.hooks[i].name,
        secret = settings.hooks[i].secret;

    settings.hooks[i].handler = addHookHandler(localPath, name, secret, sshSettings, sftpPath); ;
}

http.createServer(function (req, res) {
    /// Check the source IP.  Note that this is not the GitHub recommended way of checking.  They suggest using the secret.  We check that later this is just another check.
    if (ip.cidr(requestIp.getClientIp(req) + '/22') !== '192.30.252.0') {
        res.statusCode = 403;
        res.end('not allows from this address');
        errorHandler('Connection attempt from non GitHub IP: ' + requestIp.getClientIp(req), 'http.createServer.7777')
        return;
    }
    for (var i = 0; i < settings.hooks.length; i++) {
        if (req.url === settings.hooks[i].name) {
             settings.hooks[i].handler(req, res);
             return;
        }
    }
    res.statusCode = 404;
    res.end('no such location');
}).listen(7777);

http.createServer(function (req, res) {
    res.statusCode = 403;
    res.end('not implemented');
    var filePath = 'C:\\nick\\Git\\nickwhiteley.com\\public\\images\\brew\\beer.jpg'; //path.join(__dirname, 'myfile.mp3');
    var stat = fs.statSync(filePath);

    res.writeHead(200, {
        'Content-Type': 'inage/jpeg',
        'Content-Length': stat.size
    });

    var readStream = fs.createReadStream(filePath);
    // We replaced all the event handlers with a simple call to readStream.pipe()
    readStream.pipe(res);
}).listen(8081);

http.createServer(function (req, res) {
    /// Send messages
    if (ip.isPrivate(requestIp.getClientIp(req)) !== true) {
        res.statusCode = 403;
        res.end('not allows from this address');
        errorHandler('Connection attempt from non allowed IP: ' + requestIp.getClientIp(req), 'http.createServer.8080')
        return;
    }
    if (req.url === '/') {
        res.end('Hello');
    } else if (req.url === '/errors') {
        error.list(30, undefined, function(err, data) {
            if (err) { res.statusCode = 500; res.statusMessage = err.message; }
            else {
                data.reverse();
                res.write(JSON.stringify(data));
            }
            res.end();
        });
    } else if (req.url === '/errorscol') {
        var cols = [
            {name: 'errorLocation', value: 'Location', type: 'text'},
            {name: 'dateEntered', value: 'Date', type: 'text'},
            {name: 'message', value: 'Message', type: 'text'},
            {name: 'errorType', value: 'Type', type: 'text'}
        ];
        res.write(JSON.stringify(cols));
        res.end();
    } else if (req.url === '/errorssubscribe') {
        /** GET new videos event emmitter.  This sends a message when any new videos are added
        * 
        */
        //router.get('/newflick', function (req, res) {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            });
            notificationRecipients.push(res);
            req.once('close', function () {
                notificationRecipients.pop(res);
            });
        //});
    }else if (req.url.split('/')[1] === 'public') {
        fs.readFile(__dirname + req.url, function (err,data) {
        if (err) {
            res.writeHead(404);
            res.end(JSON.stringify(err));
            return;
        }
            res.writeHead(200);
            res.end(data);
      });
    } else {
        res.statusCode = 404
        res.end();
    }
        
}).listen(8080);

function errorHandler(err, location, errorType, res) {
    var message = err;
    if (err.message) {
        message = err.message;
    }
    if (typeof err !== 'object') {
        err = {message: err};
    }
    err.errorType = errorType;
    err.dateEntered = new Date();
    err.errorLocation = __filename + '::' + location;
    if (errorType === 'info') {
        console.log(message);
    } else {
        console.log('Error at ', location, '.', 'Message: ', message);
    }
    error.add(err);
    notificationRecipients.forEach(function (res) {
        res.write('event: newError\ndata: '+JSON.stringify(err)+'\nretry: 10000\n\n');
        res.flush();
    });
    
    if (res) {
        res.status(500);
        res.end();
    }
}


/*
gitHubPullerHandler.on('issues', function (event) {
    console.log('Received an issue event for %s action=%s: #%d %s',
        event.payload.repository.name,
        event.payload.action,
        event.payload.issue.number,
        event.payload.issue.title);
});*/