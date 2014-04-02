var http = require("http");
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
var prefix = function (str) {
	return wrap(str, '');
}
var cdataWrapper = wrap("<![CDATA[", "]]>");

function titleReplacer(str, item, fmt) {
	if (!fmt) fmt = function(x){ return x == null ? '' : x; };
	return fmt(str.replace(/{([a-z]*)}/g, function(match, arg) { switch (arg) {
		case "title":    return tryGet(item, 'title');
		case "episode":  return tryGet(item, 'episode_number');
		case "season":   return tryGet(item, 'season_number');
		case "show":     return tryGet(item, ['show', 'name']);
		case "duration": return tryGet(item, 'duration', function(x) { x = Math.round(x); return Math.floor(x / 60) + ':' + ('00' + x % 60).substr(-2); });
		default:         return match; // if we don't recognize the name, leave it be
	} }));
}

var badReq = function(response, msg) {
	response.writeHead(400, "Bad Request");
	response.end("<!DOCTYPE html><html>"
		+ "<head><title>Bad Request</title></head>"
		+ "<body><h1>Bad Request</h1>"
		+ "<p>" + msg + "</p></body></html>");
};
var errHandler = function(response, reqUrl, page) {
	return function(e) {
		response.writeHead(502, "Bad Gateway");
		response.end("<!DOCTYPE html><html>"
			+ "<head><title>Bad Gateway</title></head>"
			+ "<body><h1>Bad Gateway</h1>"
				+ "<p>Error while getting " + reqUrl.replace(/&/g, '&amp;') + ": " + e.message + "</p>"
				+ (page ? "<p>Received response:</p>"
					+ "<pre>" + page.replace(/&/g, "&amp;").replace(/>/g, "&gt;").replace(/</g, "&lt;") + "</pre>" : "")
			+ "</body></html>");
	};
};
var writeRSS = function(response, show, episodes, titleFormat) {
	response.writeHead(200, "OK", {"content-type": "application/xml+rss"});
	response.end("<rss version=\"2.0\"><channel>"
		+ "<title>" + tryGet(show, 'name', cdataWrapper) + "</title>"
		+ "<link>" + tryGet(show, 'canonical_name', prefix(URL_PREFIX)) + "</link>"
		+ tryGet(show, 'genres').split('~').map(cdataWrapper).map(wrap('<category>', '</category>')).join('')
		+ "<image>"
			+ "<url>" + tryGet(show, 'thumbnail_url', cdataWrapper) + "</url>"
			+ "<title>" + tryGet(show, 'name', cdataWrapper) + "</title>"
			+ "<link>" + tryGet(show, 'canonical_name', prefix(URL_PREFIX)) + "</link>"
		+ "</image>"
		+ "<description>" + tryGet(show, 'description', cdataWrapper) + "</description>"
		+ episodes.map(function(item) {
			item = item.video;
			if (!item) return '';
			return "<item>"
				+ "<guid>" + tryGet(item, 'id', prefix(URL_PREFIX + "watch/")) + "</guid>"
				+ "<link>" + tryGet(item, 'id', prefix(URL_PREFIX + "watch/")) + "</link>"
				+ "<pubDate>" + tryGet(item, 'released_at', cdataWrapper) + "</pubDate>"
				+ "<title>" + titleReplacer(titleFormat, item, cdataWrapper)  + "</title>"
				+ "<description>" + tryGet(item, 'description', cdataWrapper) + "</description>"
				+ "</item>";
		}).join('')
		+ "</channel></rss>");
};

function doGet(options, onSuccess, onError, redirects, maxRedirects) {
	options.path = options.path || options.pathname + (options.query ? "?" + querystring.stringify(options.query) : '');
	redirects = redirects || 0;
	maxRedirects = maxRedirects || 5;
	if (redirects > maxRedirects) {
		onError(new Error("Too many redirects."));
	} else {
		http.get(options, function(res) {
			if (Math.floor(res.statusCode/100) == 3 && "location" in res.headers) {
				res.on('data', function(chunk) { });
				var opts = url.parse(res.headers.location);
				opts.headers = options.headers;
				doGet(opts, onSuccess, onError, redirects + 1);
			} else {
				var data = '';
				res.on('data', function(chunk) {
					data += chunk;
				}).on('end', function() {
					onSuccess(data, url.format(options));
				}).on('error', onError);
			}
		}).on('error', onError);
	}
}

http.createServer(function(request, response) {
	var search = url.parse(request.url).search;
	if (search) search = querystring.parse(search.substring(1));

	var titleFormat = tryGet(search, 'format');
	if (!titleFormat) titleFormat = "{title}";

	var freeOnly = tryGet(search, 'free_only', function(x) { return x == null ? 0 : 1 });

	var limit = parseInt(tryGet(search, 'limit'));
	if (!limit || limit < 0) limit = 10;

	var showName = tryGet(search, 'show');
	if (!showName) {
		badReq(response, "You must include a <code>show</code> parameter in your query string.");
		return;
	}
	var options = {
		"protocol": "http:",
		"hostname": REMOTE_HOST,
		"pathname": '/' + showName,
		"headers": {
			"user-agent": request.headers["user-agent"]}
	};
	doGet(options, function(page, reqUrl) {
		var token = tryGet(page.match(/API_DONUT = (['"])([^'"]*)\1/), 2);
		if (!token) {
			errHandler(response, reqUrl, page)(new Error("Couldn't find token."));
			return;
		}
		// This is likely brittle; we might be better off trying to parse the URL to follow from page, like we do for token and show.
		var options = {
			"protocol": "http:",
			"hostname": REMOTE_HOST,
			"pathname": "/mozart/v1.h2o/canonical/" + showName,
			"query": {
				region: 'us',
				locale: 'en',
				language: 'en',
				include_pages: 1,
				access_token: token},
			"headers": {
				"user-agent": request.headers["user-agent"]}
		};
		doGet(options, function(show_data, reqUrl) {
			var show = tryGet(JSON.parse(show_data), ["data", 0, "show"]);
			if (!show) {
				errHandler(response, reqUrl, show_data)(new Error("Bad JSON data."));
				return;
			}
			var episodes_count = tryGet(show, "episodes_count");
			var show_id = tryGet(show, "id");
			if (!show_id) {
				errHandler(response, reqUrl, show_data)(new Error("Couldn't find show ID."));
				return;
			}
			// Also likely brittle
			var options = {
				"protocol": "http:",
				"hostname": REMOTE_HOST,
				"pathname": "/mozart/v1.h2o/shows/" + show_id + "/episodes",
				"query": {
					free_only: freeOnly,
					include_nonbrowseable: 1,
					show_id: show_id,
					sort: 'seasons_and_release',
					video_type: 'episode',
					items_per_page: episodes_count,
					position: 0,
					region: 'us',
					locale: 'en',
					language: 'en',
					access_token: token},
				"headers": {
					"user-agent": request.headers["user-agent"]}
			};
			doGet(options, function(ep_data) {
				var episodes = tryGet(JSON.parse(ep_data), 'data');
				if (!episodes) {
					episodes = [];
				}
				episodes = episodes.sort(function(a,b){
					return a.video.released_at < b.video.released_at ? 1 : -1;
				}).filter(function(x, i) {
					return i < limit;
				});
				writeRSS(response, show, episodes, titleFormat);
			}, errHandler(response, url.format(options)));
		}, errHandler(response, url.format(options)));
	}, errHandler(response, url.format(options)));
}).listen(process.argv[2] || DEFAULT_PORT);
