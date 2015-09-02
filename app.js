var http = require('http');
var https = require('https');
var path = require('path');
var fs = require('fs');
var gitHubWebhookHandler = require('github-webhook-handler');
var settings = {};

settings.hooks = [{name: '/gitHubPuller', localPath: ''}];

for (var i = 0; i < settings.hooks.length; i++) {
	var handler = gitHubWebhookHandler({ path: settings.hooks[i].name, secret: 'lorcanvida' });
	handler.on('push', function (event) {
		var added = event.payload.head_commit.added,
	        removed = event.payload.head_commit.removed,
	        modified = event.payload.head_commit.modified,
	        remotePath = event.payload.head_commit.url,
	        j;
	
	    for (j = 0; j < modified.length; j++) {
		console.log(remotePath + '/' + modified[j]);
		    https.get(remotePath + '/' + modified[j], function(err, res) {
			    if (err) { errorHandler(err, 'push1'); return; }
			    fs.write(path.join(settings.localPath, modified[j]), res.body, function(err) {
                    if (err) { errorHandler(err, 'push2'); return; }
                });
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