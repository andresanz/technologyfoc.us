'use strict';

const express    = require('express');
const { Feed }   = require('feed');

module.exports = function createFeedRouter(postsLib) {
  const router = express.Router();

  function buildFeed(req) {
    const site = req.app.locals.siteConfig();
    const feed = new Feed({
      title:       site.title,
      description: site.description,
      id:          site.url + '/',
      link:        site.url + '/',
      language:    'en',
      author:      { name: site.author, link: site.url },
    });

    postsLib.getAll().slice(0, 20).forEach(post => {
      feed.addItem({
        title:       post.title,
        id:          `${site.url}/post/${post.slug}`,
        link:        `${site.url}/post/${post.slug}`,
        description: post.excerpt,
        date:        new Date(post.date),
      });
    });

    return feed;
  }

  router.get('/rss',  (req, res) => { res.type('application/rss+xml');       res.send(buildFeed(req).rss2());  });
  router.get('/atom', (req, res) => { res.type('application/atom+xml');       res.send(buildFeed(req).atom1()); });
  router.get('/json', (req, res) => { res.type('application/feed+json');      res.send(buildFeed(req).json1()); });

  return router;
};
