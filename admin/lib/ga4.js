'use strict';
const { BetaAnalyticsDataClient } = require('@google-analytics/data');

const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/var/www/technologyfoc.us/config/ga4-key.json';

const PROPERTY_MAP = {
  'andresanz.com':             '337889293',
  '914.io':                    '397659049',
  'randomcategory.com':        '401321098',
  'therandomactofwriting.com': '527596010',
};

let client;
function getClient() {
  if (!client) client = new BetaAnalyticsDataClient({ keyFilename: KEY_FILE });
  return client;
}

async function getStats(domain, days = 30) {
  const propertyId = PROPERTY_MAP[domain];
  if (!propertyId) throw new Error(`No GA4 property mapped for ${domain}`);
  const c = getClient();
  const startDate = `${days}daysAgo`;
  const hostFilter = {
    filter: { fieldName: 'hostName', stringFilter: { value: domain, matchType: 'CONTAINS' } }
  };

  const [overview] = await c.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate: 'today' }],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'screenPageViews' },
      { name: 'averageSessionDuration' },
      { name: 'bounceRate' },
      { name: 'newUsers' },
    ],
    dimensionFilter: hostFilter,
  });

  const [daily] = await c.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
    dimensionFilter: hostFilter,
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });

  const [pages] = await c.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    dimensionFilter: hostFilter,
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 15,
  });

  const [sources] = await c.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate: 'today' }],
    dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: hostFilter,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 8,
  });

  const [countries] = await c.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate: 'today' }],
    dimensions: [{ name: 'country' }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: hostFilter,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 10,
  });

  const [devices] = await c.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate: 'today' }],
    dimensions: [{ name: 'deviceCategory' }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: hostFilter,
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  });

  const mv = (report, row, idx) => parseFloat(report.rows?.[row]?.metricValues?.[idx]?.value || 0);

  const totals = {
    sessions:    mv(overview, 0, 0),
    users:       mv(overview, 0, 1),
    pageviews:   mv(overview, 0, 2),
    avgDuration: mv(overview, 0, 3),
    bounceRate:  (mv(overview, 0, 4) * 100).toFixed(1),
    newUsers:    mv(overview, 0, 5),
  };

  const dailyData    = (daily.rows    || []).map(r => ({ date: r.dimensionValues[0].value, sessions: parseInt(r.metricValues[0].value||0), users: parseInt(r.metricValues[1].value||0) }));
  const topPages     = (pages.rows    || []).map(r => ({ path: r.dimensionValues[0].value, views: parseInt(r.metricValues[0].value||0), users: parseInt(r.metricValues[1].value||0) }));
  const topSources   = (sources.rows  || []).map(r => ({ source: r.dimensionValues[0].value, sessions: parseInt(r.metricValues[0].value||0) }));
  const topCountries = (countries.rows|| []).map(r => ({ country: r.dimensionValues[0].value, sessions: parseInt(r.metricValues[0].value||0) }));
  const topDevices   = (devices.rows  || []).map(r => ({ device: r.dimensionValues[0].value, sessions: parseInt(r.metricValues[0].value||0) }));

  return { totals, dailyData, topPages, topSources, topCountries, topDevices, days };
}

async function getPageDetail(domain, pagePath, days = 30) {
  const propertyId = PROPERTY_MAP[domain];
  if (!propertyId) throw new Error(`No GA4 property mapped for ${domain}`);
  const c = getClient();
  const startDate = `${days}daysAgo`;
  const filter = {
    andGroup: { expressions: [
      { filter: { fieldName: 'hostName',  stringFilter: { value: domain,   matchType: 'CONTAINS' } } },
      { filter: { fieldName: 'pagePath',  stringFilter: { value: pagePath, matchType: 'EXACT'    } } },
    ]}
  };

  const [daily] = await c.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
    dimensionFilter: filter,
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });

  const [sources] = await c.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate: 'today' }],
    dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
    metrics: [{ name: 'screenPageViews' }],
    dimensionFilter: filter,
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 8,
  });

  const [countries] = await c.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate: 'today' }],
    dimensions: [{ name: 'country' }],
    metrics: [{ name: 'screenPageViews' }],
    dimensionFilter: filter,
    orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    limit: 10,
  });

  const dailyData    = (daily.rows    || []).map(r => ({ date: r.dimensionValues[0].value, views: parseInt(r.metricValues[0].value||0), users: parseInt(r.metricValues[1].value||0) }));
  const topSources   = (sources.rows  || []).map(r => ({ source: r.dimensionValues[0].value, views: parseInt(r.metricValues[0].value||0) }));
  const topCountries = (countries.rows|| []).map(r => ({ country: r.dimensionValues[0].value, views: parseInt(r.metricValues[0].value||0) }));
  const totalViews   = dailyData.reduce((s, d) => s + d.views, 0);

  return { dailyData, topSources, topCountries, totalViews };
}

module.exports = { getStats, getPageDetail };
