var http = require('http');
var https = require('https');
var path = require('path');
var fs = require('fs');
var gitHubWebhookHandler = require('github-webhook-handler');
var Sftp = require('./sftp');
var settings = {};

settings.hooks = [{name: '/gitHubPuller', localPath: '/var/www/gitHubPuller', sftp: {
                username: 'nick',
                password: '654321a',
                host: '192.168.0.12',
               }}];

for (var i = 0; i < settings.hooks.length; i++) {
    var localPath = settings.hooks[i].localPath, 
        handler = gitHubWebhookHandler({ path: settings.hooks[i].name, secret: 'lorcanvida' });
    handler.on('push', function (event) {
        var added = event.payload.head_commit.added,
            removed = event.payload.head_commit.removed,
            modified = event.payload.head_commit.modified,
            //remotePath = event.payload.head_commit.url,
            remotePath =  'https://raw.githubusercontent.com/' + event.payload.repository.full_name + '/master',
            sftpClient = new Sftp.Client(settings.sftp),
            j;
        sftpClient.on('error', function(err) {
            errorHandler(err, 'sftpCluent');
        });
        for (j = 0; j < modified.length; j++) {
            var mod = modified[j], body = '';
           // remotePath = 'https://raw.githubusercontent.com/seethespark/gitHubPuller/master';
            https.get(remotePath + '/' + mod, function(res) {
               // console.log(res.body);
               res.on('data', function(chunk) { body += chunk; });
               res.on('end', function() {
               //console.log(body);
                    fs.writeFile(path.join(localPath, mod), body, function(err) {
                        if (err) { errorHandler(err, 'push2'); return; }
                        /// for testing this is inside the local write
                        sftpClient.write ({
                            content: new Buffer(body),
                            destination: '/home/nick/' + mod
                        }, function() {
                            if (err) { errorHandler(err, 'push2'); return; }
                        });
                    });
                });
                
            })
            .on('error', function(err) {
                if (err) { errorHandler(err, 'push1'); return; }
            });
        }

        console.log('Received a push event for %s to %s',
            event.payload.repository.name,
            event.payload.ref);
        /// get https://github.com/seethespark/i-flicks/archive/master.zip
    });
    handler.on('error', function (err) {
        console.error('Error:', err.message);
    });

    settings.hooks[i].handler = handler;
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
