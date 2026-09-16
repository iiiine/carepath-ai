import {test} from 'node:test';
import assert from 'node:assert/strict';
import {coordinatesOf,distanceText,navigationUrl,emergencySearchUrl} from '../src/location.js';
test('missing coordinates are not zero, while real zero is valid',()=>{
  assert.equal(coordinatesOf({latitude:null,longitude:null}),null);
  assert.equal(coordinatesOf({latitude:91,longitude:0}),null);
  assert.deepEqual(coordinatesOf({latitude:0,longitude:0}),{lat:0,lng:0});
});
test('only distances tied to supplied coordinates are displayed',()=>{
  assert.equal(distanceText({distance_meters:9999999}),'');
  assert.equal(distanceText({distance_meters:null}),'');
  assert.equal(distanceText({distance_meters:0,distance_reference:'provided_coordinates'}),'0 公尺');
});
test('navigation works by address and unlocated search invents no position',()=>{
  assert.equal(new URL(navigationUrl({name:'測試院所',address:'臺北市'})).searchParams.get('destination'),'測試院所 臺北市');
  assert.equal(new URL(emergencySearchUrl(null,'')).searchParams.get('query'),'急診');
  assert.equal(new URL(emergencySearchUrl(null,'臺北市')).searchParams.get('query'),'臺北市 急診');
});
