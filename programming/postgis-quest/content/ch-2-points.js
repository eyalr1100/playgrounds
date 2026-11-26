/* PostGIS Quest chapter 2: points on the map. A geometry column and its hex EWKB, ST_AsText and WKT, ST_X/ST_Y and
   longitude first, AS, ST_SRID and 4326, ST_MakePoint with ST_SetSRID, ST_GeomFromText. DOM-free. */
(()=>{
'use strict';
const PQ=globalThis.PQ=globalThis.PQ||{};
const need=PQ.need,G=PQ.geo;
const near=(a,b)=>Math.abs(a-b)<1e-9;
/* the result holds a point at (x, y) with SRID 4326; otherwise a tip for the usual slips: the numbers swapped, SRID 0,
   the point turned into text */
const pointAt=(x,y)=>c=>{
  const pts=c.geoms().map(o=>o.g).filter(g=>g.type==='Point');
  if(!pts.length){
    if(c.rows.some(r=>r.some(v=>typeof v==='string'&&/^POINT/i.test(v))))return 'That is the point written as text. Select the point itself, without <code>ST_AsText</code>, so the map can draw it.';
    return 'Your result has no point in it yet. Make one and select it.';
  }
  const p=pts[0];
  if(near(p.c[0],y)&&near(p.c[1],x))return 'Your point is at x = <code>'+G.fmt(p.c[0])+'</code>, y = <code>'+G.fmt(p.c[1])+'</code>: the two numbers are swapped. Longitude (x) comes first, then latitude (y).';
  if(!near(p.c[0],x)||!near(p.c[1],y))return 'Your point is at <code>'+G.fmt(p.c[0])+' '+G.fmt(p.c[1])+'</code>. The goal\'s spot is at longitude <code>'+x+'</code>, latitude <code>'+y+'</code>.';
  if(p.srid!==4326)return 'The place is right, but its SRID is <code>'+p.srid+'</code>. Give it SRID <code>4326</code>, so the database knows the numbers are longitude and latitude.';
  return true;
};
PQ.CH.push({
  name:'Points on the map',badge:'Pinch\'s Lost Pin',
  story:'Pinch the seagull has stolen pins from Odile\'s map and dropped them all over the island. Learn how the database stores a place, and put the pins back where they belong.',
  intro:'Every place in Odile\'s tables has a <code>geom</code> column: its <b>geometry</b>, the shape and position of the thing. For a well or a landmark the shape is a single <b>point</b>. PostGIS is the part of the database that understands geometries, and its functions all start with <code>ST_</code>. In this chapter you read points, and make your own.',
  learned:['ST_AsText(geom)','ST_X(geom) AS lon','ST_SRID(geom)','ST_SetSRID(ST_MakePoint(x, y), 4326)',"ST_GeomFromText('POINT(x y)', 4326)"],
  missions:[
  {title:'A geometry column',
   goal:'Show the <code>name</code> and the <code>geom</code> of the place called <code>Lighthouse</code>. Look at the strange code in <code>geom</code>, and at the map.',
   anat:[['SELECT','kw'],['name, geom','col','the name and the shape'],['FROM','kw'],['places','tbl'],['WHERE','kw'],["name = 'Lighthouse'",'val','just this place']],
   how:['<code>SELECT name, geom FROM places WHERE name = \'Lighthouse\';</code> shows one row: the lighthouse and its geometry.',
     '<code>geom</code> is a column like any other, but its values are shapes, not text or numbers.',
     'Printed as it is, a geometry comes out as a long code of digits and letters: the way the database stores it inside.',
     'The map draws the same value as a highlighted dot. Hover the row to find it.'],
   explain:'The code is called <b>hex EWKB</b>: the shape\'s bytes, written out in hexadecimal. Nobody reads it by hand. <code>0101000020E6100000</code> at the start says "a point on the Earth", and the rest are the two numbers of its position.',
   hint:'<code>SELECT name, geom FROM places WHERE name = \'Lighthouse\';</code>',
   answer:"SELECT name, geom FROM places WHERE name = 'Lighthouse';",
   wrong:["SELECT name FROM places WHERE name = 'Lighthouse';","SELECT name, geom FROM places WHERE name = 'Harbor';"],
   check:need({reads:['places'],extra:c=>c.geoms().length>0||'Include the <code>geom</code> column, so you can see the stored point.'})},

  {title:'Read a point as text',
   goal:'The code is hard to read. Show every place\'s <code>name</code> with its geometry as text, using <code>ST_AsText(geom)</code>.',
   anat:[['SELECT','kw'],['name','col'],['ST_AsText','fn','write the shape as text'],['geom','col','the shape']],
   how:['<code>SELECT name, ST_AsText(geom) FROM places;</code> lists each place with its position written out as text.',
     '<code>ST_AsText(...)</code> is a PostGIS function: it takes a geometry and returns the text form of it.',
     'The text looks like <code>POINT(-40.085 34.98)</code>: the shape\'s type, then its numbers in brackets.',
     'The first number is <b>x</b>, the second is <b>y</b>, with a space between them.'],
   explain:'This text form is called <b>WKT</b>, Well-Known Text. Every GIS tool reads and writes it, so it is the easiest way to look at a shape or to type one.',
   hint:'Wrap the column in the function: <code>ST_AsText(geom)</code>.',
   answer:'SELECT name, ST_AsText(geom) FROM places;',
   wrong:['SELECT name, geom FROM places;','SELECT name FROM places;',"SELECT name, ST_AsText(geom) FROM places WHERE kind = 'landmark';"],
   check:need({reads:['places'],calls:['st_astext']})},

  {title:'Longitude first',
   goal:'Show the <code>Windmill</code>\'s two numbers in their own columns: <code>ST_X(geom)</code> named <code>lon</code> and <code>ST_Y(geom)</code> named <code>lat</code>.',
   anat:[['ST_X(geom)','fn','the x number'],['AS','kw','call the column'],['lon','al','longitude'],['ST_Y(geom)','fn','the y number'],['lat','al','latitude']],
   how:['<code>SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM places WHERE name = \'Windmill\';</code> shows the windmill\'s position as two numbers.',
     '<code>ST_X</code> returns a point\'s x number, and <code>ST_Y</code> its y number.',
     '<code>AS lon</code> gives the new column a name of your choosing.',
     'Here x is the <b>longitude</b> (degrees east or west) and y is the <b>latitude</b> (degrees north or south): longitude always comes first.'],
   explain:'People say "latitude, longitude", but PostGIS, like most GIS tools, writes <b>x then y</b>: longitude, then latitude. Mixing them up moves a point to the other side of the world. Gullhaven is near longitude <code>-40</code> (west of Greenwich) and latitude <code>35</code> (north of the equator).',
   hint:'<code>SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM places WHERE name = \'Windmill\';</code>',
   answer:"SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM places WHERE name = 'Windmill';",
   wrong:["SELECT ST_Y(geom) AS lon, ST_X(geom) AS lat FROM places WHERE name = 'Windmill';","SELECT ST_AsText(geom) FROM places WHERE name = 'Windmill';","SELECT -40.045 AS lon, 35.035 AS lat;"],
   check:need({reads:['places'],calls:['st_x','st_y'],extra:c=>{
     const i=c.cols.findIndex(x=>x.name==='lon'),j=c.cols.findIndex(x=>x.name==='lat');
     if(i<0||j<0)return 'Name the columns with <code>AS lon</code> and <code>AS lat</code>.';
     if(c.rows.length===1&&c.rows[0][i]>0)return 'Your <code>lon</code> column holds the latitude. <code>ST_X</code> gives the longitude, <code>ST_Y</code> the latitude.';
     return true;},tip:'Show the two numbers of the <code>Windmill</code>, and only that row.'})},

  {title:'What the numbers mean',
   goal:'How does the database know these numbers are degrees on the Earth? Every geometry carries an <b>SRID</b>. Show the SRID of the <code>Harbor</code>\'s point with <code>ST_SRID(geom)</code>.',
   anat:[['SELECT','kw'],['ST_SRID','fn','which coordinate system'],['geom','col'],['FROM','kw'],['places','tbl'],['WHERE','kw'],["name = 'Harbor'",'val']],
   how:['<code>SELECT ST_SRID(geom) FROM places WHERE name = \'Harbor\';</code> shows the number that says how to read the harbor\'s coordinates.',
     'An <b>SRID</b> (spatial reference id) names a coordinate system: what the x and y numbers measure.',
     '<code>ST_SRID</code> returns that number for a geometry.',
     'You will see <code>4326</code>.'],
   explain:'SRID <code>4326</code> is <b>WGS 84</b> in longitude and latitude degrees: the system GPS uses. Every table on Gullhaven uses it. A geometry made without an SRID gets <code>0</code>, meaning "unknown", and PostGIS refuses to compare it with a 4326 one.',
   hint:'<code>SELECT ST_SRID(geom) FROM places WHERE name = \'Harbor\';</code>',
   answer:"SELECT ST_SRID(geom) FROM places WHERE name = 'Harbor';",
   wrong:['SELECT 4326;',"SELECT ST_AsText(geom) FROM places WHERE name = 'Harbor';"],
   check:need({reads:['places'],calls:['st_srid']})},

  {title:'Make a point',
   goal:'Pinch dropped a pin at longitude <code>-39.97</code>, latitude <code>35.05</code>. Make that point with SRID 4326 and select it, so the map shows it: <code>ST_SetSRID(ST_MakePoint(-39.97, 35.05), 4326)</code>.',
   anat:[['ST_SetSRID','fn','give it an SRID'],['ST_MakePoint','fn','make a point'],['-39.97','val','x: longitude'],['35.05','val','y: latitude'],['4326','val','the SRID']],
   how:['<code>SELECT ST_SetSRID(ST_MakePoint(-39.97, 35.05), 4326);</code> builds Pinch\'s point and shows it.',
     '<code>ST_MakePoint(-39.97, 35.05)</code> makes a point from x and y: longitude first.',
     'A point made this way has SRID <code>0</code>, so <code>ST_SetSRID(..., 4326)</code> wraps it and sets the SRID to 4326.',
     'A query needs no table when it only computes something, so there is no <code>FROM</code> here.'],
   explain:'Functions can go inside each other: the inner one runs first and hands its result to the outer one. Swap the two numbers and the pin lands in the Indian Ocean, far off the map.',
   hint:'<code>SELECT ST_SetSRID(ST_MakePoint(-39.97, 35.05), 4326);</code>',
   answer:'SELECT ST_SetSRID(ST_MakePoint(-39.97, 35.05), 4326);',
   wrong:['SELECT ST_SetSRID(ST_MakePoint(35.05, -39.97), 4326);','SELECT ST_MakePoint(-39.97, 35.05);','SELECT ST_AsText(ST_SetSRID(ST_MakePoint(-39.97, 35.05), 4326));','SELECT ST_SetSRID(ST_MakePoint(-39.97, 35.04), 4326);'],
   check:c=>{if(!c.calls('st_makepoint'))return 'Use <code>ST_MakePoint</code> to make the point.';return pointAt(-39.97,35.05)(c);}},

  {title:'A point from text',
   goal:'Captain Brack scribbled a spot in WKT: <code>POINT(-40.05 35.03)</code>. Turn that text into a geometry with SRID 4326 using <code>ST_GeomFromText</code>, and select it.',
   anat:[['ST_GeomFromText','fn','read WKT'],["'POINT(-40.05 35.03)'",'val','the shape as text'],['4326','val','the SRID']],
   how:['<code>SELECT ST_GeomFromText(\'POINT(-40.05 35.03)\', 4326);</code> reads the Captain\'s text and makes a real point from it.',
     'The first argument is WKT in quotes: it is text until the function reads it.',
     'The second argument is the SRID to give the new geometry.',
     'The map shows where the point is: on Windmill Hill.'],
   explain:'In WKT the numbers are separated by a space, not a comma: <code>POINT(-40.05 35.03)</code>. A comma separates whole points, as you will see in lines and shapes.',
   hint:'<code>SELECT ST_GeomFromText(\'POINT(-40.05 35.03)\', 4326);</code>',
   answer:"SELECT ST_GeomFromText('POINT(-40.05 35.03)', 4326);",
   wrong:["SELECT ST_GeomFromText('POINT(35.03 -40.05)', 4326);","SELECT ST_GeomFromText('POINT(-40.05 35.03)');","SELECT ST_SetSRID(ST_MakePoint(-40.05, 35.03), 4326);"],
   check:c=>{if(!c.calls('st_geomfromtext'))return 'Read the Captain\'s text with <code>ST_GeomFromText</code>.';return pointAt(-40.05,35.03)(c);}},
  ]});
})();
