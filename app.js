var http = require('http');
var https = require('https');
var path = require('path');
var fs = require('fs');
var gitHubWebhookHandler = require('github-webhook-handler');
var requestIp = require('request-ip');
var streamifier = require('streamifier');
var mkdirp = require('mkdirp');
var Ssh2 = require('ssh2').Client;
var Sftp = require('./sftp');
var settings = require('./.settings.js');

/// Get the GitHub file using HTTP once notified to do so. 
function getFile(fileName, localPath, remotePath, sshClient, sftpPath) {
    var binaryFile = false;
    if (localPath === undefined && remotePath === undefined) { throw new Error('localPath or remotePath must be defined'); }
    if (['.jpg', 'jpeg', '.png', '.gif', '.mp3', '.mp4'].indexOf(fileName.substr(fileName.length - 4).toLowerCase()) > -1) {
        binaryFile = true;
    }
   // remotePath = 'https://raw.githubusercontent.com/seethespark/gitHubPuller/master';
    console.log('getting ' + fileName);
    http.get(remotePath + '/' + fileName, function(res) {
        /// check res status
        var body = [];
        if (binaryFile) {
            res.setEncoding('binary');
        }
        res.on('data', function(chunk) {
            if (binaryFile) {
                body.push(new Buffer(chunk, 'binary'));
            } else {
                body+= chunk;
            }
        });
        
        res.on('end', function() {
           //console.log(body)
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
                            console.log( "Error, problem starting SFTP: %s", err );
                            process.exit( 2 );
                        }
                        sftp.mkdirParent = function(dirPath, mode, callback) {
                            var dirPathCurr = '', dirTree = dirPath.split('\\');
                            dirTree.shift();

                            function mkdir(err) {
                                var dir = dirTree.shift();
                                //if (dir === '') {mkdir();}
                                dirPathCurr += dir + '/';
                                if (dirTree.length > 0) {
                                    sftp.mkdir(dirPathCurr, mode, mkdir);
                                } else {
                                    sftp.mkdir(dirPathCurr, mode, callback);
                                }
                                
                            }
                            mkdir();

                        }
                        sftp.mkdirParenty = function(dirPath, mode, callback) {
                        //Call the standard fs.mkdir
                        console.log(dirPath);
                            sftp.mkdir(dirPath, mode, function(err) {
                            //When it fail in this way, do the custom steps
                                if (err && err.errno === 34) {
                                  //Create all the parents recursively
                                  sftp.mkdirParent(path.dirname(dirPath), mode, callback);
                                  //And then the directory
                                  sftp.mkdirParent(dirPath, mode, callback);
                                } else if (err) {
                                    errorHandler(err, 'push6'); return;
                                }
                                //Manually run the callback since we used our own callback to do all these
                                callback && callback(error);
                            });
                        };

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
             
                            // initiate transfer of file
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

/// Set up the listener for web hooks.
function addHookHandler(localPath, hookName, sshSettings, sftpPath) {
    var handler = gitHubWebhookHandler({ path: hookName, secret: 'lorcanvida' });
    handler.on('push', function (event) {
        var added = event.payload.head_commit.added,
            removed = event.payload.head_commit.removed,
            modified = event.payload.head_commit.modified,
            //remotePath = event.payload.head_commit.url,
            remotePath =  'https://raw.githubusercontent.com/' + event.payload.repository.full_name + '/master',
            remotePath = 'http://localhost:8080/' + event.payload.repository.full_name,
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
            });
        } else {   
            for (j = 0; j < modified.length; j++) {
                getFile(modified[j], localPath, remotePath);
            }
            
            for (j = 0; j < added.length; j++) {
                getFile(added[j], localPath, remotePath);
            }
        }

        console.log('Received a push event for %s to %s',
            event.payload.repository.name);
        /// get https://github.com/seethespark/i-flicks/archive/master.zip
    });
    handler.on('error', function (err) {
        console.error('Error:', err.message);
    });
    return handler;
}

for (var i = 0; i < settings.hooks.length; i++) {
    var localPath = settings.hooks[i].localPath, 
        sshSettings = settings.hooks[i].ssh,
        sftpPath = settings.hooks[i].sftpPath,
        name = settings.hooks[i].name;

    settings.hooks[i].handler = addHookHandler(localPath, name, sshSettings, sftpPath);
}

http.createServer(function (req, res) {
    console.log(requestIp.getClientIp(req));
    if (settings.gitIPs && settings.gitIPs.indexOf(requestIp.getClientIp(req)) < 0) {

        res.statusCode = 403;
        res.end('not allows from this address');
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
    var filePath = 'C:\\nick\\Git\\nickwhiteley.com\\public\\images\\brew\\beer.jpg'; //path.join(__dirname, 'myfile.mp3');
    var stat = fs.statSync(filePath);

    res.writeHead(200, {
        'Content-Type': 'inage/jpeg',
        'Content-Length': stat.size
    });

    var readStream = fs.createReadStream(filePath);
    // We replaced all the event handlers with a simple call to readStream.pipe()
    readStream.pipe(res);
}).listen(8080);

function errorHandler(err, location, errorType, res) {
    var message = err;
    if (err.message) {
        message = err.message;
    }
    if (errorType === 'info') {
        console.log(message);
    } else {
        console.log('Error at ', location, '.', 'Message: ', message);
    }
    
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