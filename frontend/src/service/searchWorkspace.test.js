import { loadSearchPage, loadSearchLabels, searchCard } from './searchWorkspace';
import { searchJobs } from './aiSearchService';
import { getListPostService, getAllCodeService } from './userService';
jest.mock('./aiSearchService',()=>({searchJobs:jest.fn()}));
jest.mock('./userService',()=>({getListPostService:jest.fn(),getAllCodeService:jest.fn()}));
beforeEach(()=>jest.clearAllMocks());
const job = {id:7,name:'Engineer',statusCode:'PS1',companyName:'Company',companyLogo:'logo',salaryJobCode:'S1'};
test('Core mapping preserves arrays and uses q without falling back to legacy',async()=>{
    searchJobs.mockResolvedValue({errCode:0,data:[job],count:1});
    const result=await loadSearchPage({search:'Node',salaryJobCode:['S1','S2'],limit:5,offset:10},'core',{SALARYTYPE:{S1:'15–20 triệu'}});
    expect(searchJobs).toHaveBeenCalledWith({q:'Node',salaryJobCode:['S1','S2'],limit:5,offset:10,sort:'relevance'});
    expect(result.data[0].postDetailData.salaryTypePostData.value).toBe('15–20 triệu');
    expect(getListPostService).not.toHaveBeenCalled();
});
test('legacy writer is explicitly retained',async()=>{
    const response={errCode:0,data:[{id:3}],count:1};getListPostService.mockResolvedValue(response);
    expect(await loadSearchPage({search:'Node'},'legacy')).toEqual({data:response.data,count:1});expect(searchJobs).not.toHaveBeenCalled();
});
test.each([{}, {errCode:0,data:[],count:-1}, {errCode:0,data:[{...job,statusCode:'PS3'}],count:1}, {errCode:503}])('Core bad response %j never falls back',async response=>{
    searchJobs.mockResolvedValue(response);await expect(loadSearchPage({},'core',{})).rejects.toThrow();expect(getListPostService).not.toHaveBeenCalled();
});
test('missing/failed reference labels display original code',async()=>{
    getAllCodeService.mockRejectedValue(new Error('offline')); const labels=await loadSearchLabels();
    expect(searchCard(job,labels).postDetailData.salaryTypePostData.value).toBe('S1');
});
