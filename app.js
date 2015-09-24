var http = require('http');
var https = require('https');
var path = require('path');
var fs = require('fs');
var gitHubWebhookHandler = require('github-webhook-handler');
var Sftp = require('./sftp');
var settings = require('./.settings.js');

/// Get the GitHub file using HTTP once notified to do so. 
function getFile(fileName, localPath, remotePath, sftpClient) {
    var body = '';
   // remotePath = 'https://raw.githubusercontent.com/seethespark/gitHubPuller/master';
    https.get(remotePath + '/' + fileName, function(res) {
       // console.log(res.body);
       res.on('data', function(chunk) { body += chunk; });
       res.on('end', function() {
       //console.log(body)
       if (localPath) {
            fs.writeFile(path.join(localPath, fileName), body, function(err) {
                if (err) { errorHandler(err, 'push2'); return; }
           });
       }
                /// for testing this is inside the local write
                try {
                    sftpClient.write ({
                        content: new Buffer(body),
                        destination: path.join(sftpPath, fileName)
                    }, function() {
                        if (err) { errorHandler(err, 'push2'); return; }
                    });
                } catch (err) {
                    errorHandler(err, 'push3');    
                }
            });
        
    })
    .on('error', function(err) {
        if (err) { errorHandler(err, 'push1'); return; }
    });
}

/// Set up the listener for web hooks.
function addHookHandler(localPath, hookName, sftpSettings, sftpPath) {
    var handler = gitHubWebhookHandler({ path: hookName, secret: 'lorcanvida' });
    handler.on('push', function (event) {
        var added = event.payload.head_commit.added,
            removed = event.payload.head_commit.removed,
            modified = event.payload.head_commit.modified,
            //remotePath = event.payload.head_commit.url,
            remotePath =  'https://raw.githubusercontent.com/' + event.payload.repository.full_name + '/master',
            sftpClient = new Sftp.Client(sftpSettings),
            j;
        sftpClient.on('error', function(err) {
            errorHandler(err, 'sftpClient');
        });
        for (j = 0; j < modified.length; j++) {
            getFile(modified[j], localPath, remotePath, sftpClient);
        }
        
        for (j = 0; j < added.length; j++) {
            getFile(added[j], localPath, remotePath, sftpClient);
        }

        console.log('Received a push event for %s to %s',
            event.payload.repository.name,
            event.payload.ref);
        /// get https://github.com/seethespark/i-flicks/archive/master.zip
    });
    handler.on('error', function (err) {
        console.error('Error:', err.message);
    });
    return handler;
}

for (var i = 0; i < settings.hooks.length; i++) {
    var localPath = settings.hooks[i].localPath, 
        sftpSettings = settings.hooks[i].sftp,
        sftpPath = settings.hooks[i].sftpPath,
        name = settings.hooks[i].name;

    settings.hooks[i].handler = addHookHandler(localPath, name, sftpSettings, sftpPath);
}

http.createServer(function (req, res) {
    for (var i = 0; i < settings.hooks.length; i++) {
        if (req.url === settings.hooks[i].name) {
             settings.hooks[i].handler(req, res);
             return;
        }
    }
    res.statusCode = 404;
    res.end('no such location');
}).listen(7777);

function errorHandler(err, location, res) {
    var message = err;
    if (err.message) {
        message = err.message;
    }
    console.log('Error at ', location, '.', 'Message: ', message);
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