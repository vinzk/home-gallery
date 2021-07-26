const debug = require('debug')('database:merge-journal')
const { mergeEntry, matchFile } = require('./merge-entry')

const { getIndexName, getJournalFilename, readJournal } = require('@home-gallery/index');

const readDatabase = require('./read-database')
const { wrapEntries, writeDatabase } = require('./write-database')

const toMap = (values, keyFn) => values.reduce((result, value) => {
  const key = keyFn(value)
  result[key] = value
  return result
}, {})

const removeFile = (dbEntry, removedFile) => {
  dbEntry.files = dbEntry.files.filter(file => !matchFile(file, removedFile))
  return !dbEntry.files.length
}

const mergeEntries = (dbEntries, newEntries, removedFiles) => {
  const dbById = toMap(dbEntries, e => e.id)

  removedFiles.forEach(file => {
    if (!dbById[file.id]) {
      return
    }
    if (removeFile(dbById[file.id], file)) {
      delete dbById[file.id]
    }
  })

  newEntries.forEach(entry => {
    dbById[entry.id] = dbById[entry.id] ? mergeEntry(dbById[entry.id], entry) : entry
  })

  const updatedEntries = Object.values(dbById)
  updatedEntries.sort((a, b) => a.date < b.date ? 1 : -1)
  return updatedEntries
}

const readJournals = (indexFilenames, journal, cb) => {
  let i = 0;
  const result = [];

  const next = () => {
    if (i >= indexFilenames.length) {
      return cb(null, result)
    }
    const indexFilename = indexFilenames[i++]
    const index = getIndexName(indexFilename)
    readJournal(indexFilename, journal, (err, journalData) => {
      if (!err) {
        debug(`Read file index journal ${getJournalFilename(indexFilename, journal)}`)
        result.push({index, data: journalData.data})
      }
      next()
    })
  }

  next()
}

const getJournalRemoves = (journals) => {
  return journals.reduce((result, journal) => {
    const { index, data } = journal
    const { changes, removes } = data

    const removed = result.concat(removes.map(({filename, sha1sum}) => { return {index, filename, id: sha1sum} }))
    return removed.concat(changes.filter(entry => entry.prevSha1sum && entry.prevSha1sum != entry.sha1sum).map(({filename, prevSha1sum}) => { return {index, filename, id: prevSha1sum} }))
  }, [])
}

const hasJournalChanges = (entries, removedFiles) => !entries.length && !removedFiles.length

const diffCount = (newData, oldData) => {
  const diff = newData.length - oldData.length
  const sign = diff > 0 ? '+' : ''
  return `${sign}${diff}`
}

const mergeFromJournal = (indexFilenames, journal, databaseFilename, entries, cb) => {
  readJournals(indexFilenames, journal, (err, journals) => {
    if (err) {
      return cb(err)
    }
    const removedFiles = getJournalRemoves(journals)
    if (hasJournalChanges(entries, removedFiles)) {
      const err = new Error(`Journals contain no changes`)
      err.code = 'ENOCHANGE'
      return cb(err)
    }
    const t0 = Date.now()
    readDatabase(databaseFilename, (err, database) => {
      if (err && err.code == 'ENOENT') {
        debug(`Initialize non existing database file ${databaseFilename}`)
        database = wrapEntries([])
      } else if (err) {
        return cb(err)
      } else {
        debug(`Read database from ${databaseFilename} with ${database.data.length} entries in ${Date.now() - t0}ms`)
      }

      const t1 = Date.now()
      const mergedEntries = mergeEntries(database.data, entries, removedFiles)
      debug(`Merged ${entries.length} new and ${removedFiles.length} removed entries from journals to ${mergedEntries.length} entries (${diffCount(mergedEntries, database.data)}) to the database in ${Date.now() - t1}ms`)

      const t2 = Date.now()
      writeDatabase(databaseFilename, mergedEntries, (err, database) => {
        if (err) {
          return cb(err)
        }
        debug(`Wrote database with ${database.data.length} entries to ${databaseFilename} in ${Date.now() - t2}ms`)
        cb(err, database)
      });
    })
  })
}

module.exports = {
  mergeFromJournal
}