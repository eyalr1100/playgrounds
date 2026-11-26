/* PostGIS Quest world: the tables of Gullhaven, a small made-up island in open Atlantic water near longitude -40,
   latitude 35 (there is no land there). Every geometry is SRID 4326: x is longitude and y is latitude, in degrees.
   Coordinates are written in thousandths of a degree from (-40, 35), so P(-20, -20) is POINT(-40.02 34.98).
   The data is laid out so each predicate shows its edge case once:
   - Village Gate sits exactly on the edge between the village and the woods (intersects, but not within);
   - the woods share an edge with the village and with the meadow, and the meadow meets the village at one corner;
   - Market Square lies inside the village, so the zones table holds a zone inside a zone;
   - the stones form three groups and two strays, which DBSCAN calls noise.
   The tables never change: every mission runs on this same world. DOM-free. */
(()=>{
'use strict';
const PQ=globalThis.PQ=globalThis.PQ||{};
const X=a=>+(-40+a/1000).toFixed(3),Y=b=>+(35+b/1000).toFixed(3);
const pt=(a,b)=>({type:'Point',srid:4326,c:[X(a),Y(b)]});
const line=(...p)=>({type:'LineString',srid:4326,c:p.map(([a,b])=>[X(a),Y(b)])});
const poly=(...p)=>{const r=p.map(([a,b])=>[X(a),Y(b)]);r.push(r[0]);return {type:'Polygon',srid:4326,c:[r]};};
const rect=(a0,b0,a1,b1)=>poly([a0,b0],[a0,b1],[a1,b1],[a1,b0]);
const C=(name,type)=>({name,type});

const island={cols:[C('name','text'),C('geom','geometry')],rows:[
  ['Gullhaven',poly([-95,-10],[-70,55],[-20,75],[40,70],[85,40],[95,-5],[70,-50],[20,-70],[-40,-75],[-80,-55])]]};
const zones={pk:'id',cols:[C('id','integer'),C('name','text'),C('kind','text'),C('geom','geometry')],rows:[
  [1,'Gullhaven Village','village',rect(-60,-40,-20,0)],
  [2,'Market Square','square',rect(-45,-25,-35,-15)],
  [3,'Whispering Woods','woods',rect(-20,-40,30,0)],
  [4,'Clover Meadow','meadow',rect(-20,0,30,40)],
  [5,'Saltmarsh','marsh',poly([40,-30],[45,20],[85,15],[80,-25])],
  [6,'Windmill Hill','hill',rect(-60,20,-30,50)]]};
const places={pk:'id',cols:[C('id','integer'),C('name','text'),C('kind','text'),C('geom','geometry')],rows:[
  [1,'Harbor','harbor',pt(-85,-20)],
  [2,'Lighthouse','landmark',pt(80,30)],
  [3,'Market Cross','landmark',pt(-40,-20)],
  [4,'Chapel','building',pt(-55,-35)],
  [5,'Windmill','building',pt(-45,35)],
  [6,'Old Oak','tree',pt(5,-20)],
  [7,'Stone Circle','landmark',pt(10,20)],
  [8,'Smugglers Cave','cave',pt(55,-50)],
  [9,'Marsh Hut','building',pt(60,0)],
  [10,'Village Gate','landmark',pt(-20,-20)]]};
const wells={pk:'id',cols:[C('id','integer'),C('name','text'),C('depth_m','integer'),C('geom','geometry')],rows:[
  [1,'Chapel Well',12,pt(-50,-10)],
  [2,'Baker Well',8,pt(-40,-30)],
  [3,'Oak Well',15,pt(0,-10)],
  [4,'Fern Well',6,pt(20,-30)],
  [5,'Clover Well',9,pt(5,30)],
  [6,'Reed Well',4,pt(65,-10)],
  [7,'Shepherd Well',11,pt(-75,25)],
  [8,'Hilltop Well',20,pt(30,60)],
  [9,'Wishing Well',7,pt(3,-48)]]};
const trails={pk:'id',cols:[C('id','integer'),C('name','text'),C('geom','geometry')],rows:[
  [1,'Coast Road',line([-85,-20],[-60,-20],[-20,-20],[30,-20],[60,-5])],
  [2,'Mill Path',line([-45,-15],[-45,35])],
  [3,'Meadow Lane',line([-20,10],[40,10])],
  [4,'Cliff Walk',line([55,-50],[70,-20],[80,30])]]};
const S=[['spiral',-68,38],['wave',-64,42],['spiral',-66,45],['star',-70,41],['wave',-62,37],['star',-67,35],
  ['star',-3,-55],['spiral',2,-52],['wave',4,-58],['star',-1,-60],['spiral',1,-56],['wave',6,-54],['star',-4,-51],
  ['wave',58,38],['spiral',62,42],['star',61,36],['wave',57,43],['spiral',64,39],
  ['star',25,10],['wave',-30,60]];
const stones={pk:'id',cols:[C('id','integer'),C('mark','text'),C('geom','geometry')],rows:S.map(([m,a,b],i)=>[i+1,m,pt(a,b)])};

PQ.WORLD={island,zones,places,wells,trails,stones};
// the order the map draws the base layers in, bottom first
PQ.LAYERS=['island','zones','trails','wells','stones','places'];
PQ.freshDb=()=>PQ.createDb(PQ.WORLD);
})();
