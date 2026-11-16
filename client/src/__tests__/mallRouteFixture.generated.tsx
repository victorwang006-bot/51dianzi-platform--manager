// @ts-nocheck
// Copied source/native Switch fixture; page markers only, not production authentication.
import React from "react";import * as NativeJsx from "react/jsx-runtime";import {Router,Route,Switch} from "wouter";
const canReply=false;
const DefaultAdminRoute=()=>React.createElement("output",{"data-route-component":"DefaultAdminRoute"},"DefaultAdminRoute");
const MaterialsRoute=()=>React.createElement("output",{"data-route-component":"MaterialsRoute"},"MaterialsRoute");
const MerchantsRoute=()=>React.createElement("output",{"data-route-component":"MerchantsRoute"},"MerchantsRoute");
const MerchantDetailRoute=()=>React.createElement("output",{"data-route-component":"MerchantDetailRoute"},"MerchantDetailRoute");
const MessagesRoute=()=>React.createElement("output",{"data-route-component":"MessagesRoute"},"MessagesRoute");
const PortalUsersRoute=()=>React.createElement("output",{"data-route-component":"PortalUsersRoute"},"PortalUsersRoute");
const OrdersRoute=()=>React.createElement("output",{"data-route-component":"OrdersRoute"},"OrdersRoute");
const AdminsRoute=()=>React.createElement("output",{"data-route-component":"AdminsRoute"},"AdminsRoute");
const StaffRoute=()=>React.createElement("output",{"data-route-component":"StaffRoute"},"StaffRoute");
const OrganizationRoute=()=>React.createElement("output",{"data-route-component":"OrganizationRoute"},"OrganizationRoute");
const ReviewsRoute=()=>React.createElement("output",{"data-route-component":"ReviewsRoute"},"ReviewsRoute");
const ExceptionLogsRoute=()=>React.createElement("output",{"data-route-component":"ExceptionLogsRoute"},"ExceptionLogsRoute");
const AnalyticsRoute=()=>React.createElement("output",{"data-route-component":"AnalyticsRoute"},"AnalyticsRoute");
const ProfileRoute=()=>React.createElement("output",{"data-route-component":"ProfileRoute"},"ProfileRoute");
const NotFoundRoute=()=>React.createElement("output",{"data-route-component":"NotFoundRoute"},"NotFoundRoute");
const BusinessChatRoute=()=>React.createElement("output",{"data-route-component":"BusinessChatRoute"},"BusinessChatRoute");
const MyInventory=()=>React.createElement("output",{"data-route-component":"MyInventory"},"MyInventory");
const MallMaterials=()=>React.createElement("output",{"data-route-component":"MallMaterials"},"MallMaterials");
const EditInventory=()=>React.createElement("output",{"data-route-component":"EditInventory"},"EditInventory");
const PublishInventory=()=>React.createElement("output",{"data-route-component":"PublishInventory"},"PublishInventory");
const InboundManagement=()=>React.createElement("output",{"data-route-component":"InboundManagement"},"InboundManagement");
const BusinessChannelInventoryRoute=()=>React.createElement("output",{"data-route-component":"BusinessChannelInventoryRoute"},"BusinessChannelInventoryRoute");
const CustomerCreate=()=>React.createElement("output",{"data-route-component":"CustomerCreate"},"CustomerCreate");
const CustomerDetail=()=>React.createElement("output",{"data-route-component":"CustomerDetail"},"CustomerDetail");
const CustomerList=()=>React.createElement("output",{"data-route-component":"CustomerList"},"CustomerList");
const CustomerDemands=()=>React.createElement("output",{"data-route-component":"CustomerDemands"},"CustomerDemands");
const CrmSalesOrders=()=>React.createElement("output",{"data-route-component":"CrmSalesOrders"},"CrmSalesOrders");
const BusinessOutboundRoute=()=>React.createElement("output",{"data-route-component":"BusinessOutboundRoute"},"BusinessOutboundRoute");
const ProcurementDemands=()=>React.createElement("output",{"data-route-component":"ProcurementDemands"},"ProcurementDemands");
const DemandQuotes=()=>React.createElement("output",{"data-route-component":"DemandQuotes"},"DemandQuotes");
const AddUser=()=>React.createElement("output",{"data-route-component":"AddUser"},"AddUser");
const BusinessUserRecordsPage=()=>React.createElement("output",{"data-route-component":"BusinessUserRecordsPage"},"BusinessUserRecordsPage");
const CompanyInfo=()=>React.createElement("output",{"data-route-component":"CompanyInfo"},"CompanyInfo");
const UnmatchedBusinessPath=()=>React.createElement("output",{"data-route-component":"UnmatchedBusinessPath"},"UnmatchedBusinessPath");
const q2=()=>React.createElement("output",{"data-route-component":"q2"},"q2");
const B2=()=>React.createElement("output",{"data-route-component":"B2"},"B2");
const Q2=()=>React.createElement("output",{"data-route-component":"Q2"},"Q2");
const P2=()=>React.createElement("output",{"data-route-component":"P2"},"P2");
const Y2=()=>React.createElement("output",{"data-route-component":"Y2"},"Y2");
const G2=()=>React.createElement("output",{"data-route-component":"G2"},"G2");
const xv=()=>React.createElement("output",{"data-route-component":"xv"},"xv");
const V2=()=>React.createElement("output",{"data-route-component":"V2"},"V2");
const X2=()=>React.createElement("output",{"data-route-component":"X2"},"X2");
const vf=()=>React.createElement("output",{"data-route-component":"vf"},"vf");
const J2=()=>React.createElement("output",{"data-route-component":"J2"},"J2");
const Z2=()=>React.createElement("output",{"data-route-component":"Z2"},"Z2");
const I2=()=>React.createElement("output",{"data-route-component":"I2"},"I2");
const K2=()=>React.createElement("output",{"data-route-component":"K2"},"K2");
const Sv=()=>React.createElement("output",{"data-route-component":"Sv"},"Sv");
const M=NativeJsx,xt=Route,i2=Switch;
function Inner(){return (<Switch>
      <Route path="/" component={MyInventory} />
      <Route path="/inventory" component={MyInventory} />
      <Route path="/mall-materials" component={MallMaterials} />
      <Route path="/publish/:id/edit" component={EditInventory} />
      <Route path="/publish" component={PublishInventory} />
      <Route path="/inbound" component={InboundManagement} />
      <Route
        path="/channel-inventory"
        component={BusinessChannelInventoryRoute}
      />
      <Route path="/customers/new/:id" component={CustomerCreate} />
      <Route path="/customers/new" component={CustomerCreate} />
      <Route path="/customers/:id" component={CustomerDetail} />
      <Route path="/customers" component={CustomerList} />
      <Route path="/customer-demands" component={CustomerDemands} />
      <Route path="/orders" component={CrmSalesOrders} />
      <Route path="/sales-orders" component={CrmSalesOrders} />
      <Route path="/outbound" component={BusinessOutboundRoute} />
      <Route path="/chat">{() => <BusinessChatRoute canReply={canReply} />}</Route>
      <Route path="/procurement-demands" component={ProcurementDemands} />
      <Route path="/procurement/demands" component={ProcurementDemands} />
      <Route path="/demand-quotes" component={DemandQuotes} />
      <Route path="/add-user" component={AddUser} />
      <Route path="/user-records" component={BusinessUserRecordsPage} />
      <Route path="/company-info" component={CompanyInfo} />
      <Route path="/company" component={CompanyInfo} />
      <Route path="/inquiries">{() => <BusinessChatRoute canReply={canReply} />}</Route>
      <Route component={UnmatchedBusinessPath} />
    </Switch>);}
function Workbench(){return <Router base="/workbench"><Inner/></Router>;}
const BusinessWorkbenchRoute=Workbench,Qt=Workbench;
export function SourceSwitch(){return (<Switch>
        <Route path={"/"}><DefaultAdminRoute /></Route>
        <Route path={"/materials"} component={MaterialsRoute} />
        <Route path={"/merchants"} component={MerchantsRoute} />
        <Route path={"/merchants/:id"} component={MerchantDetailRoute} />
        <Route path={"/messages"} component={MessagesRoute} />
        <Route path={"/portal-users"} component={PortalUsersRoute} />
        <Route path={"/orders"} component={OrdersRoute} />
        <Route path={"/orders/:id"} component={OrdersRoute} />
        <Route path={"/admins"} component={AdminsRoute} />
        <Route path={"/staff"} component={StaffRoute} />
        <Route path={"/teams"} component={OrganizationRoute} />
        <Route path={"/reviews"} component={ReviewsRoute} />
        <Route path={"/exception-logs"} component={ExceptionLogsRoute} />
        <Route path={"/analytics"} component={AnalyticsRoute} />
        <Route path={"/profile"} component={ProfileRoute} />
        <Route path={"/workbench/inbound"} component={BusinessWorkbenchRoute} />
        <Route path={"/workbench/mall-materials"} component={BusinessWorkbenchRoute} />
        <Route
          path={"/workbench/channel-inventory"}
          component={BusinessWorkbenchRoute}
        />
        <Route
          path={"/workbench/customers/:id"}
          component={BusinessWorkbenchRoute}
        />
        <Route
          path={"/workbench/customers"}
          component={BusinessWorkbenchRoute}
        />
        <Route
          path={"/workbench/customer-demands"}
          component={BusinessWorkbenchRoute}
        />
        <Route path={"/workbench/orders"} component={BusinessWorkbenchRoute} />
        <Route path={"/workbench/outbound"} component={BusinessWorkbenchRoute} />
        <Route
          path={"/workbench/inquiries"}
          component={BusinessWorkbenchRoute}
        />
        <Route path={"/workbench/chat"} component={BusinessWorkbenchRoute} />
        <Route
          path={"/workbench/procurement-demands"}
          component={BusinessWorkbenchRoute}
        />
        <Route path={"/workbench/add-user"} component={BusinessWorkbenchRoute} />
        <Route
          path={"/workbench/user-records"}
          component={BusinessWorkbenchRoute}
        />
        <Route
          path={"/workbench/company-info"}
          component={BusinessWorkbenchRoute}
        />
        <Route path={"/workbench/customers/new/:id"} component={BusinessWorkbenchRoute} />
        <Route path={"/workbench/sales-orders"} component={BusinessWorkbenchRoute} />
        <Route path={"/workbench/procurement/demands"} component={BusinessWorkbenchRoute} />
        <Route path={"/workbench/demand-quotes"} component={BusinessWorkbenchRoute} />
        <Route path={"/workbench/company"} component={BusinessWorkbenchRoute} />
        <Route path={"/404"} component={NotFoundRoute} />
        <Route component={NotFoundRoute} />
      </Switch>);}
export function CompiledSwitch(){return (M.jsxs(i2,{"data-loc":"client/src/App.tsx:263",children:[M.jsx(xt,{"data-loc":"client/src/App.tsx:264",path:"/",children:M.jsx(q2,{})}),M.jsx(xt,{"data-loc":"client/src/App.tsx:265",path:"/materials",component:B2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:266",path:"/merchants",component:Q2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:267",path:"/merchants/:id",component:P2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:268",path:"/messages",component:Y2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:269",path:"/portal-users",component:G2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:270",path:"/orders",component:xv}),M.jsx(xt,{"data-loc":"client/src/App.tsx:271",path:"/orders/:id",component:xv}),M.jsx(xt,{"data-loc":"client/src/App.tsx:272",path:"/admins",component:V2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:273",path:"/staff",component:X2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:274",path:"/teams",component:vf}),M.jsx(xt,{"data-loc":"client/src/App.tsx:277",path:"/reviews",component:J2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:278",path:"/exception-logs",component:Z2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:279",path:"/analytics",component:I2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:280",path:"/profile",component:K2}),M.jsx(xt,{"data-loc":"client/src/App.tsx:291",path:"/workbench/inbound",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:291",path:"/workbench/mall-materials",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:292",path:"/workbench/channel-inventory",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:296",path:"/workbench/customers/:id",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:300",path:"/workbench/customers",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:304",path:"/workbench/customer-demands",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:308",path:"/workbench/orders",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:309",path:"/workbench/outbound",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:310",path:"/workbench/inquiries",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:314",path:"/workbench/chat",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:315",path:"/workbench/procurement-demands",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:335",path:"/workbench/add-user",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:336",path:"/workbench/user-records",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:340",path:"/workbench/company-info",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:344",path:"/workbench/customers/new/:id",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:345",path:"/workbench/sales-orders",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:346",path:"/workbench/procurement/demands",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:348",path:"/workbench/demand-quotes",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:349",path:"/workbench/company",component:Qt}),M.jsx(xt,{"data-loc":"client/src/App.tsx:350",path:"/404",component:Sv}),M.jsx(xt,{"data-loc":"client/src/App.tsx:351",component:Sv})]}));}
