/*jslint node: true */
(function X() {
    'use strict';
    var http = require('http');
    var https = require('https');
    var path = require('path');
    var fs = require('fs');
    var gitHubWebhookHandler = require('github-webhook-handler');
    var requestIp = require('request-ip');
    var mkdirp = require('mkdirp');
    var ip = require('ip');
    var Ssh2 = require('ssh2').Client;
    var error = require('./error');
    var settings = require('./.settings.js');

    var notificationRecipients = [];

    /**
     * Standardised error handler which also writes to a database.
     * @param {object/string} err - An Error object or a string message.  Required.
     * @param {string} location - where does the error occur.  Sometimes includes parameters to indicate conditions too.
     * @param {string} errorType - error or info.  Optional and defaults to error
     * @param {object} res - Optional but if included this returns a 500 to the response.
     **/
    function errorHandler(err, location, errorType, res) {
        if (err === undefined) {
            return;
        }
        var message, errr = {};
        if (err.message) {
            message = err.message;
        } else {
            message = err;
        }

        errr.message = message;
        errr.errorType = errorType || 'error';
        errr.dateEntered = new Date();
        errr.errorLocation = __filename + '::' + location;
        if (errr.errorType === 'error') {
            console.log('Error at ', location, '.', 'Message: ', message);
        }
        /// Add it to the database
        error.add(errr);
        notificationRecipients.forEach(function (ress) {
            ress.write('event: newError\ndata: ' + JSON.stringify(errr) + '\nretry: 10000\n\n');
            //ress.flush();
        });

        if (res) {
            res.status(500);
            res.end();
        }
    }

    /// Get the GitHub file using HTTP once notified to do so.
    /**
     * Get the GitHub file using HTTP once notified to do so.
     * @param {string} hookName - The name of the hook.  only used to make meaningful errors.  Required.
     * @param {string} fileName - The name of the file er are updating.  Required.
     * @param {string} gitHubPath - Remote server path.  Required.
     * @param {string} localPath - If copying locally then this is where.  Optional.
     * @param {object} sshClient - Client for SSH when copying to a server on our network.  Optional.
     * @param {string} sftpPath - Path on the SSH server where to put files.  Optional.  If undefined then previous setting is ignored.
     **/
    function getFile(hookName, fileName, gitHubPath, localPath, sshClient, sftpPath) {
        var binaryFile = false, binaryFiles;
        if (localPath === undefined && sftpPath === undefined) {
            throw new Error('localPath or remotePath must be defined');
        }
        binaryFiles = ['.jpg', 'jpeg', '.png', '.gif', '.mp3', '.mp4'];
        if (binaryFiles.indexOf(fileName.substr(fileName.length - 4).toLowerCase()) > -1) {
            binaryFile = true;
        }
        /// message to tell we are about to get the file
        errorHandler('getting ' + fileName, 'getFile::' + hookName, 'info');
        https.get(gitHubPath + '/' + fileName, function (res) {
            /// check res status
            if (res.statusCode !== 200 && res.statusCode !== 304) {
                errorHandler('status ' + res.statusCode + '. message: ' + res.statusMessage, 'getFile2::' + hookName);
                return;
            }
            var body = '';
            if (binaryFile) {
                res.setEncoding('binary');
                body = [];
            }
            res.on('data', function (chunk) {
                if (binaryFile) {
                    body.push(new Buffer(chunk, 'binary'));
                } else {
                    body += chunk;
                }
            });
            res.on('end', function () {
                if (binaryFile) {
                    body = Buffer.concat(body);
                }
                if (localPath) {
                    /// make the directory if it doesn't exist
                    mkdirp(path.dirname(path.join(localPath, fileName)), function (err) {
                        if (err) {
                            errorHandler(err, 'push4::' + hookName);
                            return;
                        }
                        if (binaryFile) {
                            fs.writeFile(path.join(localPath, fileName), body, 'binary', function (err) {
                                if (err) {
                                    errorHandler(err, 'push2::' + hookName);
                                    return;
                                }
                                errorHandler(path.join(localPath, fileName) + ' written to the local file system', 'file sent::' + hookName, 'info');
                            });
                        } else {
                            fs.writeFile(path.join(localPath, fileName), body, function (err) {
                                if (err) {
                                    errorHandler(err, 'push2::' + hookName);
                                    return;
                                }
                                errorHandler(path.join(localPath, fileName) + ' written to the local file system', 'file sent::' + hookName, 'info');
                            });
                        }
                    });
                }

                /// Only write if the remote path is set
                if (sftpPath !== undefined) {
                    try {
                        sshClient.sftp(function (err, sftp) {
                            if (err) {
                                errorHandler(err, 'getFile.sshClient.sftp::' + hookName);
                                return;
                            }
                            sftp.mkdirParent = function (dirPath, mode, callback) {
                                var dirPathCurr = '', dirTree = dirPath.split('\\');
                                dirTree.shift();

                                function mkdir() {
                                    var dir = dirTree.shift();
                                    dirPathCurr += dir + '/';
                                    if (dirTree.length > 0) {
                                        sftp.mkdir(dirPathCurr, mode, mkdir);
                                    } else {
                                        sftp.mkdir(dirPathCurr, mode, callback);
                                    }
                                }
                                mkdir();
                            };
                            sftp.mkdirParent(path.dirname(path.join(sftpPath, fileName)), undefined, function (err) {
                                if (err) {
                                    errorHandler(err, 'push5::' + hookName);
                                    return;
                                }
                                // upload file
                                //var readStream = streamifier.createReadStream(body);
                                //console.log(readStream._object.length);
                                var writeStream = sftp.createWriteStream(path.join(sftpPath, fileName), {encoding: 'binary'});

                                // what to do when transfer finishes
                                writeStream.on(
                                    'close',
                                    function () {
                                        errorHandler(path.join(sftpPath, fileName) + ' written to ' + sshClient.config.host, 'file sent::' + hookName, 'info');
                                        sftp.end();
                                        sshClient.end();
                                    }
                                );

                                writeStream.on(
                                    'error',
                                    function (err) {
                                        errorHandler(err, 'push7::' + hookName);
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
                        errorHandler(err, 'push3::' + hookName);
                    }
                }
            });
        })
            .on('error', function (err) {
                if (err) {
                    errorHandler(err, 'push1::' + hookName);
                    return;
                }
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
    function deleteFile(hookName, fileName, localPath, sshClient, sftpPath) {
        if (localPath) {
            fs.unlink(path.join(localPath, fileName), function (err) {
                if (err) {
                    errorHandler(err, 'deleteFile 1::' + hookName);
                    return;
                }
                errorHandler(path.join(localPath, fileName) + ' deleted from the local file system', 'file delete::' + hookName, 'info');
            });
        }
        if (sftpPath) {
            sshClient.sftp(function (err, sftp) {
                if (err) {
                    errorHandler(err, 'deleteFile 2::' + hookName);
                    return;
                }
                sftp.unlink(path.dirname(path.join(sftpPath, fileName)), function (err) {
                    if (err) {
                        errorHandler(err, 'deleteFile 3::' + hookName);
                        return;
                    }
                    errorHandler(path.join(localPath, fileName) + ' deleted from ' + sshClient.config.host, 'file delete::' + hookName, 'info');
                });
            });
        }
    }

    /**
     * Set up the listener for web hooks.
     * @param {string} hookName - the name setup in GitHub
     * @param {string} localPath - path on hte local machine if hte file will be stored there
     * @param {string} secret - password for GitHub file check
     * @param {object} sshSettings - ssh server settings like host and port.
     * @param {string} sftpPath - ssh server path to store the files
     **/
    function addHookHandler(hookName, localPath, secret, sshSettings, sftpPath) {
        var handler = gitHubWebhookHandler({path: hookName, secret: secret});
        handler.on('push', function (event) {
            event.payload.commits.forEach(function (commit) {
                var added = commit.added,
                    removed = commit.removed,
                    modified = commit.modified,
                    gitHubPath = commit.url, //'https://raw.githubusercontent.com/' + event.payload.repository.full_name + '/master',
                    //gitHubPath = 'http://localhost:8081/' + event.payload.repository.full_name,
                    j;
                if (sftpPath) {
                    var ssh2 = new Ssh2();
                    ssh2.connect(sshSettings);
                    ssh2.on('error', function (err) {
                        errorHandler(err, 'sshClient::' + hookName);
                    });
                    ssh2.on('ready', function () {
                        for (j = 0; j < modified.length; j += 1) {
                            getFile(hookName, modified[j], gitHubPath, localPath, ssh2, sftpPath);
                        }
                        for (j = 0; j < added.length; j += 1) {
                            getFile(hookName, added[j], gitHubPath, localPath, ssh2, sftpPath);
                        }
                        for (j = 0; j < removed.length; j += 1) {
                            deleteFile(hookName, removed[j], localPath, ssh2, sftpPath);
                        }
                    });
                } else {
                    for (j = 0; j < modified.length; j += 1) {
                        getFile(hookName, modified[j], gitHubPath, localPath);
                    }
                    for (j = 0; j < added.length; j += 1) {
                        getFile(hookName, added[j], gitHubPath, localPath);
                    }
                    for (j = 0; j < removed.length; j += 1) {
                        deleteFile(hookName, removed[j], localPath);
                    }
                }

            });

            errorHandler('Received a push event for ' + event.payload.repository.name, 'addHookHandler::' + hookName, 'info');
            /// get https://github.com/seethespark/i-flicks/archive/master.zip
        });
        handler.on('error', function (err) {
            errorHandler(err, 'addHookHandler.1::' + hookName);
        });
        return handler;
    }
    http.createServer(function (req, res) {
        var i;
        /// Check the source IP.  Note that this is not the GitHub recommended way of checking.  They suggest using the secret.  We check that later this is just another check.
        if (ip.cidr(requestIp.getClientIp(req) + '/22') !== '192.30.252.0' && requestIp.getClientIp(req) !== '79.77.173.58') {
            res.statusCode = 403;
            res.end('not allowed from this address');
            errorHandler('Connection attempt from non GitHub IP: ' + requestIp.getClientIp(req), 'http.createServer.7777');
            return;
        }
        for (i = 0; i < settings.hooks.length; i += 1) {
            if (req.url === settings.hooks[i].name) {
                settings.hooks[i].handler(req, res);
                return;
            }
        }
        res.statusCode = 404;
        res.end('no such location');
    }).listen(7777, function () {
        var addr = this.address();
        console.log('Listening for GitHub hooks on %s:%d', ip.address(), addr.port);
        console.log('For error console see http://%s:8080/public/toolbox.html', ip.address());
        errorHandler('Listening for GitHub hooks on ' + ip.address() + ':' + addr.port, 'http.createServer', 'info');
    });

    http.createServer(function (ignore, res) {
        res.statusCode = 403;
        res.end('not implemented');
        var filePath = 'C:\\nick\\Git\\nickwhiteley.com\\public\\images\\brew\\beer.jpg'; //path.join(__dirname, 'myfile.mp3');
        fs.stat(filePath, function (err, stat) {
            if (err) {
                errorHandler(err, 'http.createServer for test file load.8081');
            }
            res.writeHead(200, {
                'Content-Type': 'inage/jpeg',
                'Content-Length': stat.size
            });

            var readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
        });

    }).listen(8081);

    http.createServer(function (req, res) {
        /// Send messages
        if (ip.isPrivate(requestIp.getClientIp(req)) !== true) {
            res.statusCode = 403;
            res.end('not allows from this address');
            errorHandler('Connection attempt from non allowed IP: ' + requestIp.getClientIp(req), 'http.createServer.8080');
            return;
        }
        if (req.url === '/errors') {
            error.list(30, undefined, function (err, data) {
                if (err) {
                    res.statusCode = 500;
                    res.statusMessage = err.message;
                } else {
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
                Connection: 'keep-alive'
            });
            notificationRecipients.push(res);
            req.once('close', function () {
                notificationRecipients.pop(res);
            });
            //});
        } else if (req.url.split('/')[1] === 'public') {
            fs.readFile(__dirname + req.url, function (err, data) {
                if (err) {
                    res.writeHead(404);
                    res.end(JSON.stringify(err));
                    return;
                }
                res.writeHead(200);
                res.end(data);
            });
        } else {
            res.statusCode = 404;
            res.end('nothing to see here, move along.');
        }

    }).listen(8080);

    /**
     * Use .settings to setup the server.
     **/
    (function start() {
        var i, localPath, sshSettings, sftpPath, hookName, secret;
        for (i = 0; i < settings.hooks.length; i += 1) {
            localPath = settings.hooks[i].localPath;
            sshSettings = settings.hooks[i].ssh;
            sftpPath = settings.hooks[i].sftpPath;
            hookName = settings.hooks[i].name;
            secret = settings.hooks[i].secret;

            settings.hooks[i].handler = addHookHandler(hookName, localPath, secret, sshSettings, sftpPath);
        }
    }());


    /*
    gitHubPullerHandler.on('issues', function (event) {
        console.log('Received an issue event for %s action=%s: #%d %s',
            event.payload.repository.name,
            event.payload.action,
            event.payload.issue.number,
            event.payload.issue.title);
        ;*/
}());