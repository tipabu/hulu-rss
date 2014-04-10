var http = require("http");
var url = require("url");
var querystring = require("querystring");

var DEFAULT_PORT = 8080;
var REMOTE_HOST = "www.hulu.com";
var URL_PREFIX = "http:/" + "/" + REMOTE_HOST + "/";

String.prototype.toXML = function toXML() {
	return this
	.replace(/&/g, "&amp;")
	.replace(/"/g, "&quot;")
	.replace(/>/g, "&gt;")
	.replace(/</g, "&lt;");
};

var defaultFormatter = function(x){ return x == null ? '' : x; };

var tryGet = function tryGet(obj, keys, fmts) {
	var val;

	if (typeof keys === "object" && 'length' in keys) {
		val = Array.prototype.reduce.call(keys, function(obj, key) {
			return obj && key in obj ? obj[key] : null;
		}, obj);
	} else {
		val = obj && keys in obj ? obj[keys] : null;
	}

	if (typeof fmts === "object" && 'length' in fmts) {
		return Array.prototype.reduce.call(fmts, function(v, fmt) { return fmt(v); }, val);
	} else if (fmts) {
		return fmts(val);
	} else {
		return defaultFormatter(val);
	}
};
var wrap = function wrap(before, after) { return function(x) {
	return x == null ? x : before + x + after;
}; };
var prefix = function prefix(str) { return wrap(str, ''); };
var tag = function tag(tagName) {
	return wrap('<' + tagName + '>', '</' + tagName + '>');
};
var cdataWrapper = function(str) {
	return wrap("<![CDATA[", "]]>")(str == null ? '' : str.replace(/\]\]>/g, ']]]><![CDATA[]>'));
};

var titleReplacer = function titleReplacer(str, item, fmts) {
	var val = str.replace(/{([a-z]*)}/g, function(match, arg) { switch (arg) {
		case "title":    return tryGet(item, 'title');
		case "episode":  return tryGet(item, 'episode_number');
		case "season":   return tryGet(item, 'season_number');
		case "show":     return tryGet(item, ['show', 'name']);
		case "duration": return tryGet(item, 'duration', function(x) {
			x = Math.round(x); return Math.floor(x / 60) + ':' + ('00' + x % 60).substr(-2);
		});
		default:         return match; // if we don't recognize the name, leave it be
	} });

	if (typeof fmts === "object" && 'length' in fmts) {
		return Array.prototype.reduce.call(fmts, function(v, fmt) { return fmt(v); }, val);
	} else if (fmts) {
		return fmts(val);
	} else {
		return defaultFormatter(val);
	}
};

var badReq = function(response, msg) {
	var title = "Bad Request";
	response.writeHead(400, title);
	response.end("<!DOCTYPE html>" + tag('html')(
		tag('head')(tag('title')(title))
		+ tag('body')(
			tag('h1')(title)
			+ tag('p')(msg)
		)
	));
};
var errHandler = function(response, reqUrl, page) {
	return function(e) {
		var title = "Bad Gateway";
		response.writeHead(502, title);
		response.end("<!DOCTYPE html>" + tag('html')(
			tag('head')(tag('title')(title))
			+ tag('body')(
				tag('h1')(title)
				+ tag('p')("Error while getting " + reqUrl.toXML() + ": " + e.message.toXML())
				+ (page ? tag('p')("Received response:")
					+ tag('pre')(page.toXML()) : "")
			)
		));
	};
};
var writeRSS = function(response, show, episodes, titleFormat) {
	response.writeHead(200, "OK", {"content-type": "application/xml+rss"});
	response.end("<rss version=\"2.0\">" + tag('channel')(
		tryGet(show, 'name', [cdataWrapper, tag('title')])
		+ tryGet(show, 'canonical_name', [prefix(URL_PREFIX), tag('link')])
		+ tryGet(show, 'genres').split('~').map(cdataWrapper).map(tag('category')).join('')
		+ tag('image')(
			tryGet(show, 'thumbnail_url', [cdataWrapper, tag('url')])
			+ tryGet(show, 'name', [cdataWrapper, tag('title')])
			+ tryGet(show, 'canonical_name', [prefix(URL_PREFIX), tag('link')])
		) + tryGet(show, 'description', [cdataWrapper, tag('description')])
		+ episodes.map(function(item) {
			item = item.video;
			if (!item) return '';
			return tag("item")(
				tryGet(item, 'id', [prefix(URL_PREFIX + "watch/"), tag('guid')])
				+ tryGet(item, 'id', [prefix(URL_PREFIX + "watch/"), tag('link')])
				+ tryGet(item, 'released_at', [cdataWrapper, tag('pubDate')])
				+ titleReplacer(titleFormat, item, [cdataWrapper, tag('title')])
				+ tryGet(item, 'description', [cdataWrapper, tag('description')]));
		}).join('')
	) + "</rss>");
};

var doGet = function doGet(options, onSuccess, onError, redirects, maxRedirects) {
	options.path = options.path || options.pathname + (options.query ? "?" + querystring.stringify(options.query) : '');
	redirects = redirects || 0;
	maxRedirects = maxRedirects || 5;
	if (redirects > maxRedirects) {
		onError(new Error("Too many redirects."));
	} else {
		http.get(options, function(res) {
			if (res.statusCode >= 300 && res.statusCode <= 399 && "location" in res.headers) {
				res.on('data', function(chunk) { });
				var opts = url.parse(res.headers.location);
				opts.headers = options.headers;
				doGet(opts, onSuccess, onError, redirects + 1, maxRedirects);
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
};

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
