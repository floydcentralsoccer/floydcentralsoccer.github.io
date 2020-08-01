/*******************************************************/
/*  Main application Supports Clusters and Domains     */
/*******************************************************/
var cluster = require('cluster');
var url = require('url');
var http = require('http');
var path = require('path');
var fs = require('fs');
var querystring = require('querystring');

var api = {};
api["v1"] = require('./js/apiv1.js');
var defaultVersion = "v1";

//variables used for configuration
var PORT = +process.env.PORT || 3200;
var WORKERS = process.env.WORKERS || require('os').cpus().length;

var main = (function () {
	if (cluster.isMaster) {
		//master process
		console.log('Master started.  Starting cluster with %s workers.', WORKERS);		
		
		//for dev, only need 1 process.
		for (var i = 0; i < WORKERS; ++i) {
			var worker = cluster.fork().process;
			console.log('Worker %s started.  Listening on port %s.', worker.pid, PORT);
		}

		cluster.on('exit', function(worker) {
			cluster.fork();
			console.log('Worker %s died. Restarted.', worker.process.pid);
		});			
		
	} else {
		//worker process, called once per worker, each worker has its own memory
		var domain = require('domain');  
	
		var server = require('http').createServer(function (req, res) {
			var d = domain.create();
		
			d.on('error', function (er) {
				console.error('error from app.js worker process: ', er.stack);

				//note: uncaught error has occurred! By definition, something unexpected occurred,
				try {
					//try to send an error to the request that triggered the problem
					res.writeHead(500, {
						"Context-Type": "text/plain"
					});
					
					res.write('error: ' + er.stack);						
					res.end();
					
					//make sure we close down within 30 seconds
					var killtimer = setTimeout(function () {
						process.exit(1);
					}, 30000);
					//but don't keep the process open just for that!
					killtimer.unref();

					//stop taking new requests.
					server.close();

					//let the master know we're dead.  This will trigger a 'disconnect' in the cluster master, and then it will fork a new worker.
					cluster.worker.disconnect();

				} catch (er2) {
					//not much we can do at this point.
					console.error('Error sending 500!', er2.stack);
				}
			});

			//req and res were created before this domain existed, need to explicitly add them.
			d.add(req);
			d.add(res);

			//now run the handler function in the domain.  This will handle each request.
			d.run(function () {
					var queryData = url.parse(req.url, true).query;
					
				var postData = '';
				
				//chunk post data, append
				req.addListener('data', function (postDataChunk) {
					postData += postDataChunk;
				});
				
				//post data done, process
				req.addListener('end', function () {
					var data = {};
					
					if(postData != '') {
						data = JSON.parse(postData);
					}

					/********************************************/
					/*  GET DATA FROM THE URL'S QUERYSTRING     */
					/********************************************/
					// Get the request url
					var urlObj = url.parse(req.url, true);
				 
					// Add querystring parms to data
					for(q in urlObj['query']) {
							//console.log( q + " = " + urlObj['query'][q]);
							data[q] = urlObj['query'][q];
					}
					
					var uri;
					uri = url.parse(req.url).pathname;
					
					//extract version and method to build call to api
					var reqparts = uri.split("/");
					var version;
					var method;
					var arrayLength = reqparts.length;
					for (var i = 0; i < arrayLength; i++) {
						if(reqparts[i] === 'api') {
							version = reqparts[i+1];
							method = reqparts[i+2];
						}
					}
					
					//if not set, default
					if(!version) {
						version = defaultVersion;
					}
					
					if(method) {
						if(req.method=='POST') {

						
						} else {
							var fn = 'fetch' + method;
							
							if (fn in api[version]) {
								//function exists
								api[version][fn](data, callback);	
							}
							else {
								//function does not exist
								console.log("Error: could not find " + version + "/" + fn + " API method");
								res.writeHead(400, {'Content-Type': 'application/json'});
								res.write('{"error": "API method not found"}');
								res.end();							  
							}				
						}						
					} else {
						//else server from disk (html, images, favicon, ...)						
						api[version]["serveFromDisk"](uri, res);
					}
					
				});
			});
			
			var callback = function(err,data) {
				if(err) {
					console.log('callback err: %s', err);
					res.writeHead(400, {'Content-Type': 'application/json'});
					res.write('{"error": "' + err + '"}');
					res.end(); 
				} else {
					//cache for 10 minutes local, shared cache 1 hour  -- or use without cache for dev debugging
					res.writeHead(200, {'Content-Type': 'application/json', "Cache-Control": "public, max-age=600, s-maxage=3600"});
					
					//no cache
					//res.writeHead(200, {'Content-Type': 'application/json'});	
					
					res.write(JSON.stringify(data));
					res.end();
				}	
			};	
			
		});		
		
		server.listen(PORT);
	} //end worker

})();




