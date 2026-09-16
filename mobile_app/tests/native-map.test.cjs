// Render the native map element tree with native modules stubbed (not a device test).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const babel=require('../node_modules/@babel/core');
const React=require('../node_modules/react');
const vm=require('node:vm');
function load(file, dependencies) {
 const {code}=babel.transformFileSync(file,{presets:[[require.resolve('../node_modules/babel-preset-expo'),{jsxRuntime:'classic'}]],plugins:[require.resolve('../node_modules/@babel/plugin-transform-modules-commonjs')],configFile:false,babelrc:false});
 const exports={}; vm.runInNewContext(code,{exports,require:name=>Object.hasOwn(dependencies,name)?dependencies[name]:require(require.resolve(name,{paths:[require('node:path').resolve('mobile_app')]}))}); return exports;
}
const location=load('mobile_app/src/utils/location.js',{});
const Map=load('mobile_app/src/components/NearbyHospitalMap.native.js',{'react':React,'react-native':{Platform:{OS:'ios'},View:'View',Text:'Text'},'react-native-maps':{__esModule:true,default:'Map',Marker:'Marker',PROVIDER_GOOGLE:'google'},'../utils/location':location}).default;
const markers=tree=>React.Children.toArray(tree.props.children).filter(x=>x.type==='Marker');
test('no coordinates renders explanation instead of fake user marker',()=>assert.equal(Map({hospitals:[{latitude:null,longitude:null}]}).type,'View'));
test('hospital center does not invent user location',()=>{
 const tree=Map({hospitals:[{latitude:25,longitude:121,name:'院所'}]});
 assert.equal(markers(tree).length,1); assert.equal(markers(tree)[0].props.title,'院所');
});
test('genuine zero user coordinates accepted; invalid hospital omitted',()=>{
 const tree=Map({userLocation:{latitude:0,longitude:0},hospitals:[{latitude:99,longitude:0}]});
 assert.equal(markers(tree).length,1);
 assert.equal(markers(tree)[0].props.title,'問診當時位置');
 assert.deepEqual(JSON.parse(JSON.stringify(markers(tree)[0].props.coordinate)),{latitude:0,longitude:0});
});
