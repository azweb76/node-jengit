var githubhook = require('githubhook');
var http = require('http');
var config = require('./config');
var util = require('util');
var qs = require('querystring');

var github = githubhook({ port: config.port || 3420 });

github.listen();

github.on('*', function (event, repo, ref, data) {
	var jobInfo = config.repos[repo.toLowerCase()];

	if(util.isArray(jobInfo)){
		for (var i = 0; i < jobInfo.length; i++) {
			handleJobEvent(event, repo, ref, data, jobInfo[i]);
		};
	}
	else {
		handleJobEvent(event, repo, ref, data, jobInfo);
	}
});

function handleJobEvent(event, repo, ref, data, jobInfo){
	if(jobInfo && event === jobInfo.event && jobInfo.jobName){
		if(event === 'push' && data.commits.length === 0){
			console.log('skip push - no commits');
			return false;
		}

		var pr = null;
		if (event === 'pull_request'){
			pr = data.number;
			if(["opened","synchronize"].indexOf(data.action) === -1){
				console.log('skip pull_request action ' + data.action);
				return false;
			}
		}

		var refParse = jobInfo.ref || ['^refs\/heads\/([0-9A-Za-z-_]+)$','^([0-9A-Za-z-_]+)$']
		var branch = null;

		if(!ref){
			ref = data.ref || (data[event] && data[event].head && data[event].head.ref);
		}

		if(ref){
			for (var i = 0; i < refParse.length; i++) {
				var expr = refParse[i];
				var m = ref.match(expr);

				if(m && m.length){
					branch = m[m.length-1];
					break;
				}
			};
			if(!branch){
				console.log('skip ref ' + ref);
				return false;
			}
		}

		if (jobInfo.branch){
			var isMatch = false;
			for (var i = 0; i < jobInfo.branch.length; i++) {
				var b = jobInfo.branch[i];
				if (branch.match(b)){
					isMatch = true;
					break;
				}
			}

			if (!isMatch){
				console.log('skip branch ' + branch);
				return false;
			}
		}

		console.log(event, ref, branch);

		var user = (data.pusher && data.pusher.name) || (data.sender && data.sender.login) || (data.comment && data.comment.login);
		var commitID = data.after || (data.comment && data.comment.commit_id) || (data.pull_request && data.pull_request.head.sha);

		if (jobInfo.msgExpr){
			var msg = (data.comment && data.comment.body);
			if(msg){
				if(msg.toLowerCase() === jobInfo.msgExpr.toLowerCase()){
					triggerBuild(jobInfo, commitID, user, branch, pr);
				}
			}
			else {
				console.log('no message');
			}
		}
		else {
			triggerBuild(jobInfo, commitID, user, branch, pr);
		}
	}
}

function triggerBuild(jobInfo, hash, user, branch, pr){
	var options = {
	  hostname: 'jenkins.intranet.gdg',
	  path: '/job/' + jobInfo.jobName + '/buildWithParameters?GIT_HASH=' + hash + 
	  	(user ? '&GIT_USER=' + qs.escape(user) : '') + 
	  	(branch ? '&GIT_BRANCH=' + qs.escape(branch) : '') + 
	  	(pr ? '&GIT_PR=' + pr : '') + 
	  	'&token=' + jobInfo.token,
	  method: 'GET'
	};

	var req = http.request(options, function(res) {
	  console.log("statusCode: ", res.statusCode);
	  console.log("headers: ", res.headers);

	  res.on('data', function(d) {
	    process.stdout.write(d);
	  });
	});
	req.end();

	req.on('error', function(e) {
	  console.error(e);
	});
}