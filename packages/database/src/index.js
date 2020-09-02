const path = require('path');
const { pipeline } = require('stream');

const { readStreams } = require('@home-gallery/index');

const { processIndicator, filter, flatten, sort, each, toList } = require('@home-gallery/stream');
const mapToCatalogEntry = require('./map-catalog-entry');
const readEntryFilesGrouped = require('./read-entry-files-grouped');
const groupByDir = require('./group-by-dir');
const groupSidecarFiles = require('./group-sidecar-files');
const mapToMedia = require('./map-media');
const writeCatalog = require('./write-catalog');

function build(indexFilenames, storageDir, catalogFilename, fileFilterFn, cb) {
  readStreams(indexFilenames, (err, entryStream) => {
    if (err) {
      return cb(err);
    }

    const supportedTypes = ['image', 'rawImage', 'video'];

    let totalFiles = 0;
    pipeline(
      entryStream,
      filter(entry => entry.fileType === 'f' && entry.sha1sum && entry.size > 0),
      filter(entry => fileFilterFn(entry.filename)),
      // Sort by index and filename
      toList(),
      sort(entry => `${entry.indexName}:${entry.filename}`, true),
      each(entry => { totalFiles = entry.length }),
      flatten(),
      mapToCatalogEntry,
      // Stream entry list
      groupByDir(),
      readEntryFilesGrouped(storageDir),
      processIndicator({name: 'read directories'}),
      groupSidecarFiles,
      // Stream single entry
      flatten(),
      filter(entry => supportedTypes.indexOf(entry.type) >= 0),
      mapToMedia,
      processIndicator({name: 'map to media'}),
      toList(),
      sort(entry => entry.date, true).on('data', entries => {
        writeCatalog(catalogFilename, entries, (err, catalog) => {
          if (err) {
            return cb(err);
          }
          cb(null, catalog);
        });
      }),
      (err) => {
        if (err) {
          debug(`Could not build database: ${err}`);
          return cb(err);
        }
      }
    );
  })
}

module.exports = build;
