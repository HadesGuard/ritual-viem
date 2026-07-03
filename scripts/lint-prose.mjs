// Reject em dashes and en dashes in authored prose (source, tests, README).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['src', 'test', 'scripts', 'README.md']
const BAD = new RegExp('[\\u2014\\u2013]')

let failures = 0
function check(path) {
  const st = statSync(path)
  if (st.isDirectory()) {
    for (const entry of readdirSync(path)) {
      if (entry === 'fixtures' || entry === 'node_modules') continue
      check(join(path, entry))
    }
    return
  }
  const lines = readFileSync(path, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (BAD.test(line)) {
      console.error(`${path}:${i + 1}: em/en dash found`)
      failures++
    }
  })
}

for (const root of ROOTS) {
  try {
    check(root)
  } catch {
    // missing root is fine
  }
}
if (failures) {
  console.error(`${failures} prose lint failure(s)`)
  process.exit(1)
}
console.log('prose lint clean')
