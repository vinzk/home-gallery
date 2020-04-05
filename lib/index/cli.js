const async = require('async');
const path = require('path');
const debug = require('debug')('cli:index');

const fileFilter = require('../utils/file-filter');

const readIndex = require('./read');
const createIndex = require('./create');
const updateIndex = require('./update');
const writeIndex = require('./write');
const checksum = require('./checksum');
const { statIndex, prettyPrint } = require('./stat');

const command = {
  command: 'index',
  describe: 'Create or update file index',
  builder: (yargs) => {
    return yargs.option({
      index: {
        alias: 'i',
        describe: 'File index filename',
        default: 'fs.idx'
      },
      directory: {
        alias: ['d', 'dir'],
        describe: 'Directory of file index',
        default: '.'
      },
      checksum: {
        alias: 'c',
        boolean: true,
        default: false,
        describe: 'Calculate file checksums'
      },
      exclude: {
        alias: 'e',
        array: true,
        describe: 'Exclude gitignore pattern'
      },
      'exclude-from-file': {
        alias: 'E',
        describe: 'Exclude gitignore patterns from file'
      },
      'exclude-if-present': {
        alias: 'X',
        describe: 'Exclude files and directories if file is present'
      }
    })
    .demandOption(['index', 'directory'])
    .command(
      'stats',
      'Print index statistics', 
      (yargs) => yargs, 
      (argv) => {
        stats(argv.index, () => true)
      })
  },
  handler: (argv) => {
    fileFilter(argv.exclude, argv['exclude-from-file'], (err, fileFilterFn) => {
      if (err) {
        debug(`${err}`);
      } else {
        update(argv.directory, argv.index, argv.checksum, fileFilterFn, argv['exclude-if-present'], () => true)
      }
    })
  }
}

const createOrUpdate = (base, indexFilename, fileFilterFn, excludeIfPresent, cb) => {
  const now = new Date();
  async.waterfall([
    (callback) => readIndex(indexFilename, callback),
    (fileIndex, callback) => {
      createIndex(base, fileFilterFn, excludeIfPresent, (err, fsEntries) => {
        if (err) {
          return callback(err);
        }
        updateIndex(fileIndex.entries, fsEntries, (err, entries, changed) => {
          if (err) {
            return callback(err);
          }
          callback(null, fileIndex, entries, changed);
        })
      })
    },
    (fileIndex, entries, changed, callback) => {
      if (changed) {
        writeIndex(indexFilename, {
          type: 'fileindex',
          version: 1,
          created: now.toISOString(),
          base: path.resolve(base),
          entries
        }, callback)
      } else {
        callback(null, fileIndex);
      }
    }
  ], cb);
}

const update = (base, indexFilename, calculateChecksum, ignoreFn, excludeIfPresent, cb) => {
  const t0 = Date.now();
  async.waterfall([
    (callback) => createOrUpdate(base, indexFilename, ignoreFn, excludeIfPresent, callback),
    (index, callback) => {
      if (calculateChecksum) {
        const sha1sumDate = new Date().toISOString();
        return checksum(index, sha1sumDate, (err, index, changed) => {
          if (err) {
            return callback(err);
          } else if (changed) {
            return writeIndex(indexFilename, index, callback);
          } else {
            return callback(null, index);
          }
        })
      } else {
        return callback(null, index);
      }
    }
  ], (err, index) => {
    if (err) {
      debug(`Could not update file index ${indexFilename}: ${err}`);
      cb(err);
    } else {
      debug(`Successfully updated file index in ${Date.now() - t0}ms`);
      cb(null, index);
    }
  });
}

const stats = (indexFilename, cb) => {
  statIndex(indexFilename, (err, stats) => {
    if (err) {
      debug(`Could not read file index ${indexFilename}: ${err}`);
      return cb(err);
    }
    console.log(prettyPrint(stats));
    cb(null, stats);
  })
}

module.exports = command