import { loadSearchPage, loadSearchLabels, searchCard } from './searchWorkspace';
import { searchJobs } from './aiSearchService';
import { getListPostService, getAllCodeService } from './userService';
import { filterExternalJobs } from './externalJobs';
jest.mock('./aiSearchService',()=>({searchJobs:jest.fn()}));
jest.mock('./userService',()=>({getListPostService:jest.fn(),getAllCodeService:jest.fn()}));
jest.mock('./externalJobs',()=>({filterExternalJobs:jest.fn(),externalJobCard:job=>({...job,listingSource:'external'})}));
beforeEach(()=>{jest.clearAllMocks();filterExternalJobs.mockReturnValue([]);});
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

test.each(['core', 'legacy'])('JobFind jobs lead and the external suffix paginates without dropping or repeating (%s)', async mode => {
    const external = Array.from({length:7}, (_, index) => ({id:`external-${index}`}));
    filterExternalJobs.mockReturnValue(external);
    const native = Array.from({length:8}, (_, index) => ({...job,id:index+1}));
    const api = mode === 'core' ? searchJobs : getListPostService;
    api.mockImplementation(async ({offset,limit}) => ({errCode:0,count:native.length,data:native.slice(offset,offset+limit)}));
    const pages = [];
    for (const offset of [0,5,10]) pages.push(await loadSearchPage({offset,limit:5}, mode, {}, {includeExternal:true}));
    expect(pages.map(page=>page.count)).toEqual([15,15,15]);
    expect(pages.map(page=>page.data.length)).toEqual([5,5,5]);
    expect(pages.flatMap(page=>page.data.map(row=>row.id))).toEqual([...native,...external].map(row=>row.id));
    expect(api.mock.calls.map(([params])=>[params.offset,params.limit])).toEqual([[0,5],[5,5],[10,5]]);
});

test('external jobs alone fill pages when no JobFind job matches', async () => {
    filterExternalJobs.mockReturnValue([{id:'external-0'},{id:'external-1'},{id:'external-2'}]);
    searchJobs.mockResolvedValue({errCode:0,data:[],count:0});
    const page = await loadSearchPage({offset:2,limit:5}, 'core', {}, {includeExternal:true});
    expect(page).toEqual({count:3,data:[{id:'external-2',listingSource:'external'}]});
});

test('external matches do not conceal a failed native search', async () => {
    filterExternalJobs.mockReturnValue([{id:'external-1'}]);
    searchJobs.mockResolvedValue({errCode:503,errMessage:'Service unavailable'});
    await expect(loadSearchPage({limit:5,offset:0},'core',{}, {includeExternal:true})).rejects.toThrow('Service unavailable');
});

test('native-only consumers such as Candidate AI keep numeric job IDs', async () => {
    filterExternalJobs.mockReturnValue([{id:'external-1'}]);
    searchJobs.mockResolvedValue({errCode:0,data:[job],count:1});
    const result = await loadSearchPage({limit:8,offset:0}, 'core', {});
    expect(result.data.map(row=>row.id)).toEqual([7]);
    expect(result.count).toBe(1);
    expect(filterExternalJobs).not.toHaveBeenCalled();
});
