var http = require('http');
var gitHubWebhookHandler = require('github-webhook-handler');
var GitHubApi = require("github");

var iFLicksHandler = gitHubWebhookHandler({ path: '/i-flicks', secret: 'lorcanvida' });
var gitHubPullerHandler = gitHubWebhookHandler({ path: '/gitHubPuller', secret: 'lorcanvida' });

var gitHubApi = new GitHubApi({
    // required
    version: "3.0.0",
    // optional
    debug: true,
    protocol: "https",
    host: "api.github.com", // should be api.github.com for GitHub
    timeout: 5000,
    headers: {
        "user-agent": "Nicks-GitHub-App" // GitHub is happy with a unique user agent
    }
});

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
			if (err) { errorHandler('push1', errl); return; )
			fs.write(res.body, function(err) {}
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