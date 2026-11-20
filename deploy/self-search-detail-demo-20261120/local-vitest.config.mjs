import base from '/home/ubuntu/work/resume-frontend/frontend-vitest.config.mjs';
export default {
  ...base,
  test: {
    ...base.test,
    include: [
      'client/src/components/OfficialMallSearchResults.inline.test.tsx',
      'client/src/components/OfficialMallSearchResults.polish.test.tsx',
      'client/src/components/OfficialMaterialResources.SearchPage.test.tsx',
      'client/src/components/OfficialMaterialResources.polish.test.tsx',
      'client/src/pages/OfficialProductDetail.test.tsx',
      'client/src/pages/ProductDetail.route.test.tsx',
    ],
  },
};
