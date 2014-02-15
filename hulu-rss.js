var http = require("http");
var https = require("https");
var url = require("url");
var querystring = require("querystring");

var DEFAULT_PORT = 8080;
var REMOTE_HOST = "www.hulu.com";
var URL_PREFIX = "http:/" + "/" + REMOTE_HOST + "/";

function tryGet(obj, keys, fmt) {
	if (!fmt) fmt = function(x){ return x == null ? '' : x; };
	if (typeof keys === "object" && 'length' in keys) {
		return fmt(Array.prototype.reduce.call(keys, function(obj, key) { return obj && key in obj ? obj[key] : null; }, obj));
	} else {
		return fmt(obj && keys in obj ? obj[keys] : null);
	}
}
function wrap(before, after) {
	return function(x){ return x == null ? '' : before + x + after; };
}
function prefix(str) {
	return wrap(str, '');
}

function titleReplacer(str, item) {
	return str.replace(/{([a-z]*)}/g, function(match, arg) { switch (arg) {
		case "title":    return tryGet(item, 'title');
		case "episode":  return tryGet(item, 'episode_number');
		case "season":   return tryGet(item, 'season_number');
		case "show":     return tryGet(item, ['show', 'name']);
		case "duration": return tryGet(item, 'duration', function(x) { x = Math.round(x); return Math.floor(x / 60) + ':' + ('00' + x % 60).substr(-2); });
		default:         return match; // if we don't recognize the name, leave it be
	} });
}

var badReq = function(response, msg) {
	response.writeHead(400, "Bad Request");
	response.end("<!DOCTYPE html><html>"
		+ "<head><title>Bad Request</title></head>"
		+ "<body><h1>Bad Request</h1>"
		+ "<p>" + msg + "</p></body></html>");
};
var errHandler = function(response, reqUrl) {
	return function(e) {
		response.writeHead(502, "Bad Gateway");
		response.end("<!DOCTYPE html><html>"
			+ "<head><title>Bad Gateway</title></head>"
			+ "<body><h1>Bad Gateway</h1>"
			+ "<p>Received error while getting " + reqUrl.replace(/&/g, '&amp;') + ":<br/><pre>" + e + "</pre></p></body></html>");
	};
};

http.createServer(function(request, response) {
	var search = url.parse(request.url).search;
	if (search) search = querystring.parse(search.substring(1));

	var titleFormatter = tryGet(search, 'format');
	if (!titleFormatter) titleFormatter = "{title}";

	var urlToFetch = tryGet(search, 'show');
	if (!urlToFetch) {
		badReq(response, "You must include a <code>show</code> parameter in your query string.");
	} else {
		var options = {
			"hostname": REMOTE_HOST,
			"path": '/' + urlToFetch,
			"headers": {
				"user-agent": request.headers["user-agent"]
			}
		};

		http.get(options, function(res) {
			var page = '';
			res.on('data', function(chunk) {
				page += chunk;
			}).on('end', function() {
				var token = tryGet(page.match(/API_DONUT = (['"])([^'"]*)\1/), 2);
				var show = tryGet(page.match(/(['"])id\1:\s*(\d+),/), 2);
				if (!token) {
					response.writeHead(502, "Bad Gateway");
					response.end("<!DOCTYPE html><html>"
						+ "<head><title>Bad Gateway</title></head>"
						+ "<body><h1>Bad Gateway</h1>"
						+ "<p>Couldn't find access token.</p>"
						+ "<p>Received response:<br/><pre>" + page.replace(/>/g, "&gt;").replace(/</g, "&lt;") + "</pre></p></body></html>");
				} else if (!show) {
					response.writeHead(502, "Bad Gateway");
					response.end("<!DOCTYPE html><html>"
						+ "<head><title>Bad Gateway</title></head>"
						+ "<body><h1>Bad Gateway</h1>"
						+ "<p>Couldn't find show ID.</p>"
						+ "<p>Received response:<br/><pre>" + page.replace(/>/g, "&gt;").replace(/</g, "&lt;") + "</pre></p></body></html>");
				} else {
					// This is likely brittle; we might be better off trying to parse the URL to follow from page, like we do for token and show.
					var options = {
						"hostname": REMOTE_HOST,
						"path": "/mozart/v1.h2o/shows/" + show + "/episodes?" + querystring.stringify({
							free_only: 0,
							include_nonbrowseable: 1,
							show_id: show,
							sort: 'seasons_and_release',
							video_type: 'episode',
							items_per_page: 32,
							position: 0,
							region: 'us',
							locale: 'en',
							language: 'en',
							access_token: token}),
						"headers": {
							"user-agent": request.headers["user-agent"]
						}
					};
					http.get(options, function(res) {
						var ep_data = '';
						res.on('data', function(chunk) {
							ep_data += chunk;
						}).on('end', function() {
							var episodes = JSON.parse(ep_data).data;
							if (!episodes) {
								errHandler(response, url.format(options))(new Error("No JSON data."));
								return;
							}
							response.writeHead(200, "OK", {"content-type": "application/xml+rss"});
							response.end("<rss version=\"2.0\"><channel>"
								+ "<title>" + tryGet(episodes, [0, 'video', 'show', 'name']) + "</title>"
								+ "<link>" + tryGet(episodes, [0, 'video', 'show', 'canonical_name'], prefix(URL_PREFIX)) + "</link>"
								+ "<description>" + tryGet(episodes, [0, 'video', 'show', 'link_description'], wrap('<![CDATA[', ']]>')) + "</description>"
								+ episodes.sort(function(a,b){
									return a.video.released_at < b.video.released_at ? 1 : -1;
								}).map(function(item) {
									item = item.video;
									if (!item) return '';
									return "<item>"
										+ "<guid>" + tryGet(item, 'id', prefix(URL_PREFIX + "watch/")) + "</guid>"
										+ "<link>" + tryGet(item, 'id', prefix(URL_PREFIX + "watch/")) + "</link>"
										+ "<pubDate><![CDATA[" + tryGet(item, 'released_at') + "]]></pubDate>"
										+ "<title><![CDATA[" + titleReplacer(titleFormatter, item)  + "]]></title>"
										+ "<description><![CDATA[" + tryGet(item, 'description') + "]]></description>"
										+ "</item>";
								}).join('')
								+ "</channel></rss>");
						}).on('error', errHandler(response, url.format(options)));
					}).on('error', errHandler(response, url.format(options)));
				}
			}).on('error', errHandler(response, url.format(options)));
		}).on('error', errHandler(response, url.format(options)));
	}
}).listen(process.argv[2] || DEFAULT_PORT);
