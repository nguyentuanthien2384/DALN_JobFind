import { progressByLegacyCv, applicationStage } from './applicationProgress';
const row={id:'900',legacy_cv_id:12,job_id:7,stage:'phong_van'};
test('joins by legacy CV ID and verifies job ID, never by application ID',()=>{
    const progress=progressByLegacyCv({errCode:0,data:[row,{...row,id:901,legacy_cv_id:null}]});
    expect(applicationStage({id:12,postId:7},progress)).toBe('Phỏng vấn');
    expect(applicationStage({id:900,postId:7},progress)).toBe('Đang chờ đồng bộ');
    expect(applicationStage({id:12,postId:8},progress)).toBe('Chưa đối chiếu được công việc');
});
test.each([{errCode:503},{errCode:0,data:[{...row,legacy_cv_id:undefined}]},{errCode:0,data:[row,row]},
    {errCode:0,data:[{...row,stage:'unknown'}]},{errCode:0,data:[{...row,job_id:'7e0'}]}, {errCode:0,data:[{id:900,job_id:7,stage:'phong_van'}]}])('rejects incomplete or conflicting progress %j',response=>{
    expect(()=>progressByLegacyCv(response)).toThrow();
});
