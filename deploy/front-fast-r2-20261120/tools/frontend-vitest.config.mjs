const root='/home/ubuntu/work/resume-frontend/platform';
export default {
  root,
  resolve:{alias:{'@':root+'/client/src','@shared':root+'/shared'}},
  esbuild:{jsx:'automatic'},
  test:{
    environment:'jsdom',
    include:[
      'client/src/pages/SearchPage.fast-terminal.test.tsx',
      'client/src/components/OfficialMallSearchResults.inline.test.tsx',
      'client/src/components/OfficialMaterialResources.SearchPage.test.tsx',
      'client/src/hooks/useGuestQuery.fast.test.ts',
      'client/src/hooks/useOfficialMaterial.polish.test.tsx',
      'client/src/lib/officialMaterialClient.polish.test.ts',
      'client/src/lib/searchResultCommit.test.ts',
      'client/src/components/home/__tests__/homepageBanner.contract.test.ts',
      'client/src/components/home/__tests__/WarmInventoryHero.test.tsx'
    ],
    pool:'forks',minWorkers:1,maxWorkers:2,testTimeout:30000,hookTimeout:30000
  }
};
