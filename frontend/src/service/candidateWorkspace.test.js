import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';
import { prepareIntent, saveIntent, readIntent, clearIntent, intentStorageKey, validateTaskResponse, acceptTask,
    validateAiResult, cvPayload, validateCvList, emptyCv, cvText, readPdf } from './candidateWorkspace';

beforeAll(() => { Object.defineProperty(window, 'crypto', { configurable:true, value:webcrypto }); global.TextEncoder = TextEncoder; });
beforeEach(() => { sessionStorage.clear(); });
const payload = { resumeText:'Sensitive CV text', jobId:7 };
test('persists only task identity/hash, preserves key after refresh and scopes by user', async () => {
    const intent = await prepareIntent(7,'match_cv',payload); saveIntent(7,intent);
    expect(sessionStorage.getItem(intentStorageKey(7))).not.toContain('Sensitive');
    expect(readIntent(8)).toBeNull();
    expect(await prepareIntent(7,'match_cv',payload)).toEqual({ ...intent, rejected:false });
    await expect(prepareIntent(7,'match_cv',{ ...payload, jobId:8 })).rejects.toThrow('đúng');
    const accepted = acceptTask({ errCode:0,taskId:'task-7' }, intent); saveIntent(7,accepted);
    expect(readIntent(7).taskId).toBe('task-7');
    await expect(prepareIntent(7,'match_cv',payload)).rejects.toThrow();
    expect(() => clearIntent(7,'different')).toThrow(); clearIntent(7,intent.key); expect(readIntent(7)).toBeNull();
});
test('definitive refusal allows changed input but retains the same key', async () => {
    const intent = await prepareIntent(7,'match_cv',payload); saveIntent(7,{ ...intent,rejected:true });
    await expect(prepareIntent(7,'match_cv',{ ...payload,jobId:9 },false)).rejects.toThrow('đúng');
    const next = await prepareIntent(7,'match_cv',{ ...payload,jobId:9 });
    expect(next.key).toBe(intent.key); expect(next.digest).not.toBe(intent.digest);
});
test.each(['{','null','{}','{"version":2}'])('fails closed on corrupt stored intent: %s', raw => {
    sessionStorage.setItem(intentStorageKey(7),raw); expect(() => readIntent(7)).toThrow();
});
test.each([{errCode:0,taskId:''},{errCode:0,taskId:'a/b?c'},{errCode:0,taskId:'task',httpStatus:503},{errCode:500}])('rejects malformed acceptance %j', response => {
    expect(() => acceptTask(response,{})).toThrow();
});
test('rejects wrong task ID/type before displaying a result', () => {
    const intent = { taskId:'one',type:'match_cv' };
    expect(validateTaskResponse({errCode:0,data:{id:'two',type:'match_cv'}},intent).httpStatus).toBe(400);
    expect(validateTaskResponse({errCode:0,data:{id:'one',type:'cover_letter'}},intent).httpStatus).toBe(400);
});
test('CV roundtrip strips DB/internal fields and includes experience/education in AI input', () => {
    const value = { ...emptyCv(),title:'Dev',roleCode:'ADMIN',parsedFrom:{raw:'hidden'},_id:'507f1f77bcf86cd799439011',
        experiences:[{company:'Example',position:'Engineer',from:'2020',to:'2024',description:'Built services',_id:'bad'}],educations:[{school:'School',major:'CS',degree:'BSc',year:'2020'}] };
    const clean = cvPayload(value); expect(clean.roleCode).toBeUndefined(); expect(clean.parsedFrom).toBeUndefined();
    expect(clean.experiences[0]._id).toBeUndefined(); expect(cvText(value)).toContain('Built services');
    expect(validateCvList({errCode:0,data:[value]})[0]._id).toBe(value._id);
    expect(() => validateCvList({errCode:0,data:[value,value]})).toThrow();
});
test.each([null,{score:101},{score:'80'},{score:80,matchedSkills:[{}]}])('invalid AI data cannot render as successful: %j', result => {
    expect(() => validateAiResult('match_cv',result)).toThrow();
});
test('parsed CV is editable with all nested data and nullable fields', () => {
    const result = validateAiResult('parse_resume',{fullName:'Lan',phone:null,experiences:[{company:'X',duration:'2020–2024'}],educations:[{school:'Y'}]});
    expect(result.phone).toBe(''); expect(result.experiences[0].from).toBe('2020–2024'); expect(result.educations[0].school).toBe('Y');
});
test('PDF reader rejects wrong extension, oversized data and disguised text', async () => {
    await expect(readPdf(new File(['text'],'cv.txt'))).rejects.toThrow('PDF');
    await expect(readPdf({name:'cv.pdf',size:6*1024*1024})).rejects.toThrow('PDF');
    await expect(readPdf(new File(['text'],'cv.pdf'))).rejects.toThrow('định dạng');
    await expect(readPdf(new File(['%PDF-1.4\nsynthetic'],'cv.pdf'))).resolves.toMatchObject({fileName:'cv.pdf'});
});
