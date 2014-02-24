Hulu-RSS
========

Simple Node.js proxy to create RSS feeds for TV shows on Hulu.

Hulu recently stopped making feeds available at http://www.hulu.com/feed.
Sadly, this spoiled one of my favorite HTPC features: using Firefox's [Live Bookmarks](http://kb.mozillazine.org/Live_Bookmarks_-_Firefox) feature to watch for new episodes.
I could just drop all of the feeds for shows I want to watch into one Bookmarks Toolbar folder, and easily scan through them to find new episodes.
I should have seen this coming, of course.
The feed links were long ago removed from the main show pages, which meant adding new feeds [got much more complicated](http://forum.serviio.org/viewtopic.php?f=20&t=4620&start=70#p51772).

Usage
-----

Once you've got [Node](http://nodejs.org/) installed, just run `node hulu-rss.js` to start the server.
By default, the server starts on port 8080; you can change this by adding the desired port as an argument on the commandline.

To get the RSS feed for a show, simply got to `http://localhost:8080/?show=show-name`, replacing `show-name` with the canonical name taken from the show's main Hulu page.
For example, the URL for Family Guy (Hulu's most popular show) is `http://www.hulu.com/family-guy`, so the feed would be at `http://localhost:8080/?show=family-guy`.

Feed Options
------------

### Title Formatting ###

I added the ability to format episode titles as you like.
By default, just the episode title is displayed.
To override this, add a `format` parameter to the url: `http://localhost:8080/?show=show-name&format=fmt-string`.
`fmt-string` can include the following tokens, which will be replaced with information about the episode:

* `{title}`
* `{season}`
* `{episode}`
* `{show}`
* `{duration}` (formatted as `m:ss`)

Any other text will be left as-is.

FWIW, Hulu's format (when they were still generating feeds) was `{show} - s{season} | e{episode} - {title}`.

### Episode Limit ###

You can specify a limit on how many episodes to return.
To enable this filter, include a `limit` parameter in the url.
By default, the limit is 10.

### Only Show Free Episodes ###

There was also an option in Hulu's API to only return free episodes.
To enable this filter, include a `free_only` parameter in the url.
The value doesn't matter; only the existence of the parameter.

Common Issues
-------------
### EACCES
```
events.js:72
        throw er; // Unhandled 'error' event
              ^
Error: listen EACCES
    at errnoException (net.js:901:11)
    ...
```

Your user doesn't have permission to listen on the specified port.
This often will happen on Mac or Linux systems if you specify a port below 1024.
To get around this, either run as root (not recommended) or use a different port.

### EADDRINUSE
```
events.js:72
        throw er; // Unhandled 'error' event
              ^
Error: listen EADDRINUSE
    at errnoException (net.js:901:11)
    ...
```

Some other program is already using the specified port.
Pick a different port number.
