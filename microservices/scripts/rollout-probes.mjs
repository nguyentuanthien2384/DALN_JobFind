// Sent to an existing running container via `docker exec node -e`, with no shell.
// Import drivers only: importing an app/ORM entrypoint could execute startup DDL.
export const mysqlProbe = `
const mysql = await import('mysql2/promise'); let db; let phase='connect';
try {
 db = await mysql.createConnection({host:process.env.MYSQL_HOST || 'host.docker.internal',port:Number(process.env.MYSQL_PORT || 3333),
 user:process.env.MYSQL_USER || 'root',password:process.env.MYSQL_PASSWORD || '',database:process.env.MYSQL_DATABASE || 'jobfindtest',connectTimeout:5000});
 phase='timeout';
 try {await db.query('SET SESSION MAX_EXECUTION_TIME=5000');}catch{await db.query('SET SESSION max_statement_time=5');}
 phase='metadata';
 await db.query('START TRANSACTION READ ONLY');
 const [tables] = await db.query('SELECT LOWER(TABLE_NAME) AS name, ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
 const [columns] = await db.query('SELECT LOWER(TABLE_NAME) AS tableName, COLUMN_NAME AS name, DATA_TYPE AS type, CHARACTER_MAXIMUM_LENGTH AS length, COLLATION_NAME AS collation, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
 const [indexes] = await db.query('SELECT LOWER(TABLE_NAME) AS tableName, INDEX_NAME AS name, COLUMN_NAME AS columnName, NON_UNIQUE AS nonUnique, SUB_PART AS prefix, SEQ_IN_INDEX AS position FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX');
 let outbox=null;
 if(tables.some(t=>t.name==='outbox_events')) { try { const [rows]=await db.query('SELECT COUNT(*) AS pending, MAX(TIMESTAMPDIFF(SECOND,createdAt,NOW())) AS oldestSeconds FROM outbox_events WHERE publishedAt IS NULL');outbox=rows[0]; }catch{} }
 console.log(JSON.stringify({tables,columns:columns.map(r=>({...r,table:r.tableName})),indexes:indexes.map(r=>({...r,table:r.tableName,column:r.columnName})),outbox,rootAccount:(process.env.MYSQL_USER || 'root')==='root'}));
} catch(error) { console.log(JSON.stringify({unavailable:true,phase,code:/^[A-Z0-9_]+$/.test(error.code || '')?error.code:'UNKNOWN'})); } finally { if(db){await db.rollback().catch(()=>{});await db.end();} }
`;

export const postgresProbe = `
const {default:pg}=await import('pg');const db=new pg.Client({connectionString:process.env.POSTGRES_URL,connectionTimeoutMillis:5000,statement_timeout:5000});
try {await db.connect();await db.query('BEGIN READ ONLY');
 const {rows:columns}=await db.query("SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('applications','application_events','application_notes','talent_pool')");
 const {rows:indexes}=await db.query("SELECT tablename, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('applications','application_events','application_notes','talent_pool')");
 console.log(JSON.stringify({columns,indexes}));
} catch {console.log(JSON.stringify({unavailable:true}));}finally{await db.query('ROLLBACK').catch(()=>{});await db.end().catch(()=>{});}
`;
