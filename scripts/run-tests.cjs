// Sequential runner: fail fast; never talks to a real fiscal or mail service.
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const dbOnly = process.argv.includes('--db');
const all = process.argv.includes('--all');
function run(args) {
  console.log('\n> node '+args.join(' '));
  const result = spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
  if(result.error) throw result.error;
  if(result.status!==0) process.exit(result.status||1);
}
if(!dbOnly) {
  run(['node_modules/typescript/bin/tsc','-p','tests/tsconfig.all.json']);
  const files=fs.readdirSync('tests').filter(f=>f.endsWith('.test.ts')).sort().map(f=>path.join('.test-build/tests',f.replace(/\.ts$/,'.js')));
  run(['--conditions=react-server','--test',...files]);
  run(['scripts/check-outgoing-invoice-delete.cjs']);
  run(['scripts/check-client-permission-matrix.cjs']);
  run(['scripts/check-company-purge-coverage.mjs']);
}
if(dbOnly||all) {
  // Explicit isolated database is mandatory for the complete integration suite.
  // Existing individual rollback scripts remain usable against local development DB.
  if(!process.env.TEST_DATABASE_URL) throw new Error('Postavite TEST_DATABASE_URL na posebnu testnu bazu, pa primijenite migracije.');
  const url=new URL(process.env.TEST_DATABASE_URL);
  if(!/_test(?:_|$)/i.test(url.pathname)) throw new Error('Naziv testne baze mora sadržati _test.');
  process.env.DATABASE_URL=process.env.TEST_DATABASE_URL;
  for(const name of ['employment-contracts','deadlines','agency-statistics','bank-statement-warnings','agency-profile','accounting-core','accounting-concurrency','invoice-lifecycle','office-storno','client-portal','fixed-assets','fixed-assets-tax','mail-import']) {
    run(['scripts/check-'+name+'.cjs']);
  }
}
console.log('\nSve izabrane provjere su prošle.');
