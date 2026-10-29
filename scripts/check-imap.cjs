/* eslint-disable @typescript-eslint/no-require-imports -- Local operator diagnostic, no secret output. */
require('@next/env').loadEnvConfig(process.cwd(),false,{info(){},error(){}});
const {prisma}=require('../.test-build/src/lib/prisma.js');
const {mailAccountOptions}=require('../.test-build/src/lib/mail-accounts.js');
const {probeImap}=require('../.test-build/src/lib/imap-connection.js');
(async()=>{try{
 const id=process.argv[2];
 const accounts=await prisma.agencijaMailNalog.findMany({where:{...(id?{id}:{}),aktivan:true,is_deleted:false},select:{id:true,agencija_id:true}});
 if(accounts.length!==1)throw Error('Select one account');
 const a=accounts[0],options=await mailAccountOptions(a.agencija_id,a.id);
 const result=await probeImap({},undefined,25000,options);console.log(JSON.stringify(result));if(!result.ok)process.exitCode=1;
}finally{await prisma.$disconnect()}})().catch(()=>{console.error('IMAP provjera nije završena. Ako imate više naloga, navedite ID naloga iza komande.');process.exitCode=1});
