import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coordinatesOf, distanceText, navigationUrl, emergencySearchUrl } from '../src/utils/location.js';
import { summaryMode } from '../src/utils/summary.js';
import { locate } from '../src/utils/locate.js';

test('missing / invalid coordinates rejected, genuine zero retained', () => {
  for (const p of [null, {latitude:null,longitude:null}, {latitude:91,longitude:0}, {latitude:0,longitude:Infinity}]) assert.equal(coordinatesOf(p),null);
  assert.deepEqual(coordinatesOf({latitude:0,longitude:0}),{lat:0,lng:0});
});
test('legacy and missing distances hidden; explicit zero shown', () => {
  assert.equal(distanceText({distance_meters:9999999}),'');
  assert.equal(distanceText({distance_meters:null,distance_reference:'provided_coordinates'}),'');
  assert.equal(distanceText({distance_meters:0,distance_reference:'provided_coordinates'}),'0 公尺');
});
test('address navigation never needs null coordinates', () => {
  assert.equal(new URL(navigationUrl({name:'院所',address:'臺南市',latitude:null,longitude:null})).searchParams.get('destination'),'院所 臺南市');
  assert.equal(new URL(emergencySearchUrl(null,'')).searchParams.get('query'),'急診');
  assert.equal(new URL(emergencySearchUrl(null,'臺北市')).searchParams.get('query'),'臺北市 急診');
});
for (const [name,result,guest,expected] of [
  ['saved',{session_id:42,save_status:'saved'},false,'saved'],
  ['failed with ID',{session_id:42,save_status:'failed'},false,'unavailable'],
  ['missing ID',{save_status:'saved'},false,'unavailable'],
  ['legacy member',{},false,'unavailable'],
  ['history',{session_id:999},false,'saved'],
  ['guest',{save_status:'not_applicable'},true,'local'],
  ['legacy guest',{},true,'local'],
  ['failed guest',{save_status:'failed'},true,'unavailable'],
]) test(`summary ${name}`,()=>assert.equal(summaryMode(result,guest),expected));
const mock = (status, position) => ({Accuracy:{Balanced:3}, requestForegroundPermissionsAsync:async()=>({status}),getCurrentPositionAsync:position});
test('denied permission never asks for position', async()=> {
  assert.deepEqual(await locate(mock('denied',()=>assert.fail('must not locate'))),{position:null,status:'denied'});
});
test('granted valid position retained',async()=> {
  assert.deepEqual(await locate(mock('granted',async()=>({coords:{latitude:0,longitude:0}}))),{position:{latitude:0,longitude:0},status:'success'});
});
test('position timeout returns no fallback',async()=> {
  assert.deepEqual(await locate(mock('granted',()=>new Promise(()=>{})),5),{position:null,status:'timeout'});
});
test('provider error returns no fallback',async()=> {
  assert.deepEqual(await locate(mock('granted',async()=>{throw Error('offline')})),{position:null,status:'unavailable'});
});
