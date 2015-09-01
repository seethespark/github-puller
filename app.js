var http = require('http');
var path = require('path');
var fs = require('filesystem');
var gitHubWebhookHandler = require('github-webhook-handler');
var settings = {};
settings.localPath = 'c:\\blaa';

var iFLicksHandler = gitHubWebhookHandler({ path: '/i-flicks', secret: 'lorcanvida' });
var gitHubPullerHandler = gitHubWebhookHandler({ path: '/gitHubPuller', secret: 'lorcanvida' });

http.createServer(function (req, res) {
    gitHubPullerHandler(req, res, function (err) {
        res.statusCode = 404;
        res.end('no such location');
    });
}).listen(7777);
function errorHandler(err, location, res) {
    console.log('Error at ', location, '.', 'Message: ', err.message);
    if (res) {
        res.status(500);
        res.end();
    }
}
gitHubPullerHandler.on('error', function (err) {
    console.error('Error:', err.message);
});

gitHubPullerHandler.on('push', function (event) {
	var added =event.payload.commits.added,
	    removed =event.payload.commits.removed,
	    changed =event.payload.commits.changed,
	    remotePath =event.payload.url,
	    i;
	
	for (i = 0; i < added.length; i++) {
		http.get(remotePath + '/' + added[i], function(err, res) {
			if (err) { errorHandler('push1', err); return; )
			fs.write(path.join(settings.localPath, added[i]), res.body, function(err) {
                if (err) { errorHandler('push2', err); return; )
            }
		}
	}
	
	
	
    console.log('Received a push event for %s to %s',
        event.payload.repository.name,
        event.payload.ref);
    /// get https://github.com/seethespark/i-flicks/archive/master.zip
});

gitHubPullerHandler.on('issues', function (event) {
    console.log('Received an issue event for %s action=%s: #%d %s',
        event.payload.repository.name,
        event.payload.action,
        event.payload.issue.number,
        event.payload.issue.title);
});