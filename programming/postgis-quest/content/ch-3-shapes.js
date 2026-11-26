/* PostGIS Quest chapter 3: lines and shapes. LineString and Polygon WKT, ST_Length, closed rings, ST_Area with
   round(...::numeric, n), ST_Centroid, ST_GeometryType, and drawing a polygon with ST_GeomFromText. DOM-free. */
(()=>{
'use strict';
const PQ=globalThis.PQ=globalThis.PQ||{};
const need=PQ.need,G=PQ.geo,REL=PQ.relate;
const TRI=G.parse('POLYGON((-40.05 35.03,-40.04 35.03,-40.045 35.04,-40.05 35.03))');
PQ.CH.push({
  name:'Lines and shapes',badge:'Mapmaker\'s Outline',
  story:'Odile drew the island\'s paths as lines and its fields and woods as shapes. Measure them, find their middles, and copy her sketch of the windmill\'s secret corner.',
  intro:'Not everything is a point. A path is a <b>line</b>: points joined one after another. A wood or a field is a <b>polygon</b>: a closed outline with an inside. The tables <code>trails</code> and <code>zones</code> hold Odile\'s lines and polygons. This chapter reads them, measures them and draws one of your own.',
  learned:['LINESTRING(x y, x y, ...)','ST_Length(geom)','POLYGON((... first point again))','round(ST_Area(geom)::numeric, 4)','ST_Centroid(geom)','ST_GeometryType(geom)'],
  missions:[
  {title:'Lines',
   goal:'Show the <code>name</code> of every trail in the table <code>trails</code>, with its geometry as text.',
   anat:[['SELECT','kw'],['name','col'],['ST_AsText(geom)','fn','the shape as text'],['FROM','kw'],['trails','tbl','the paths']],
   how:['<code>SELECT name, ST_AsText(geom) FROM trails;</code> lists each trail with its line written out.',
     'A line\'s text is <code>LINESTRING(</code> and then its points, separated by commas.',
     'Each point is still <code>x y</code> with a space: longitude, then latitude.',
     'The path runs from the first point to the next one, and so on to the last. The map draws each trail.'],
   explain:'A line needs at least two points. The points in between are where the path bends: the Coast Road has five points, so it has four straight pieces.',
   hint:'<code>SELECT name, ST_AsText(geom) FROM trails;</code>',
   answer:'SELECT name, ST_AsText(geom) FROM trails;',
   wrong:['SELECT name, geom FROM trails;','SELECT name, ST_AsText(geom) FROM places;'],
   check:need({reads:['trails'],calls:['st_astext']})},

  {title:'The longest trail',
   goal:'Which trail is the longest? Show the <code>name</code> and <code>ST_Length(geom)</code> of the one longest trail.',
   anat:[['ST_Length','fn','how long'],['ORDER BY','kw'],['ST_Length(geom)','fn','sort by length'],['DESC','kw','longest first'],['LIMIT 1','kw','one row']],
   how:['<code>SELECT name, ST_Length(geom) FROM trails ORDER BY ST_Length(geom) DESC LIMIT 1;</code> measures every trail and keeps the longest.',
     '<code>ST_Length(geom)</code> adds up the lengths of a line\'s straight pieces.',
     '<code>ORDER BY</code> can sort by a calculation, not just by a column.',
     '<code>DESC LIMIT 1</code> keeps the top of the list, as in chapter 1.'],
   explain:'The length comes out in <b>degrees</b>, because the coordinates are degrees: about <code>0.15</code> for the Coast Road. A degree of latitude is about 111 km, but a degree of longitude shrinks towards the poles, so degrees are fine for comparing lengths here and poor for real distances. Chapter 5 measures in metres.',
   hint:'Sort with <code>ORDER BY ST_Length(geom) DESC</code> and keep one row with <code>LIMIT 1</code>.',
   answer:'SELECT name, ST_Length(geom) FROM trails ORDER BY ST_Length(geom) DESC LIMIT 1;',
   wrong:['SELECT name, ST_Length(geom) FROM trails ORDER BY ST_Length(geom) LIMIT 1;','SELECT name, ST_Length(geom) FROM trails;',"SELECT name, ST_Length(geom) FROM trails WHERE name = 'Coast Road';"],
   check:need({reads:['trails'],calls:['st_length'],has:['order','limit']})},

  {title:'Polygons',
   goal:'Show the <code>Saltmarsh</code> zone\'s outline as text: its <code>name</code> and <code>ST_AsText(geom)</code> from the table <code>zones</code>.',
   anat:[['SELECT','kw'],['name, ST_AsText(geom)','fn'],['FROM','kw'],['zones','tbl','fields, woods and more'],['WHERE','kw'],["name = 'Saltmarsh'",'val']],
   how:['<code>SELECT name, ST_AsText(geom) FROM zones WHERE name = \'Saltmarsh\';</code> shows the marsh\'s outline.',
     'A polygon\'s text is <code>POLYGON((</code>, its corners separated by commas, and <code>))</code>.',
     'The list of corners is a <b>ring</b>, and it is closed: its last point repeats the first.',
     'The double brackets are there because a polygon can hold more rings, for holes cut out of it.'],
   explain:'The Saltmarsh has four corners, so its ring has five points. A ring that does not end where it starts is refused with <code>geometry contains non-closed rings</code>.',
   hint:'<code>SELECT name, ST_AsText(geom) FROM zones WHERE name = \'Saltmarsh\';</code>',
   answer:"SELECT name, ST_AsText(geom) FROM zones WHERE name = 'Saltmarsh';",
   wrong:['SELECT name, ST_AsText(geom) FROM zones;',"SELECT name, geom FROM zones WHERE name = 'Saltmarsh';"],
   check:need({reads:['zones'],calls:['st_astext']})},

  {title:'Area, rounded',
   goal:'Show every zone\'s <code>name</code> and its area rounded to 4 decimals, as a column called <code>area</code>, the biggest first: <code>round(ST_Area(geom)::numeric, 4) AS area</code>.',
   anat:[['round','fn','round to n decimals'],['ST_Area(geom)','fn','the area'],['::numeric','op','as an exact number'],['4','val','decimals'],['AS area','al'],['ORDER BY area DESC','kw','biggest first']],
   how:['<code>SELECT name, round(ST_Area(geom)::numeric, 4) AS area FROM zones ORDER BY area DESC;</code> lists the zones by size, with short numbers.',
     '<code>ST_Area(geom)</code> is the area inside a polygon, in square degrees here.',
     'Its raw result has many digits, like <code>0.0015999999999999318</code>, so <code>round(..., 4)</code> keeps 4 decimals.',
     '<code>round</code> with decimals takes an exact number type called <code>numeric</code>. <code>::numeric</code> turns the area into one. <code>ORDER BY area</code> sorts by the new column\'s name.'],
   explain:'The tiny errors in the last digits come from storing decimals in binary, not from PostGIS. Leave out <code>::numeric</code> and you get <code>function round(double precision, integer) does not exist</code>: a classic PostgreSQL surprise. <code>::</code> is how SQL changes a value\'s type.',
   hint:'<code>SELECT name, round(ST_Area(geom)::numeric, 4) AS area FROM zones ORDER BY area DESC;</code>',
   answer:'SELECT name, round(ST_Area(geom)::numeric, 4) AS area FROM zones ORDER BY area DESC;',
   wrong:['SELECT name, ST_Area(geom) AS area FROM zones ORDER BY area DESC;','SELECT name, round(ST_Area(geom)::numeric, 2) AS area FROM zones ORDER BY area DESC;','SELECT name, round(ST_Length(geom)::numeric, 4) AS area FROM zones;'],
   check:need({reads:['zones'],calls:['st_area','round'],has:['order'],extra:c=>c.cols.some(x=>x.name==='area')||'Name the rounded column <code>area</code> with <code>AS area</code>.'})},

  {title:'The middle of a shape',
   goal:'Mark the middle of every zone: show each zone\'s <code>name</code> and <code>ST_Centroid(geom)</code>. The map draws the middles on top of the zones.',
   anat:[['SELECT','kw'],['name','col'],['ST_Centroid','fn','the middle point'],['geom','col'],['FROM','kw'],['zones','tbl']],
   how:['<code>SELECT name, ST_Centroid(geom) FROM zones;</code> finds the middle point of each zone.',
     '<code>ST_Centroid</code> takes any geometry and returns a <b>new</b> point: its centre of mass.',
     'Select the point itself, not as text, and the map draws a dot at each middle.',
     'Hover a row to see which dot belongs to which zone.'],
   explain:'A function can return a new geometry, not only a number or text. The centroid is the balance point of the shape. For a strangely bent shape it can even lie outside it.',
   hint:'<code>SELECT name, ST_Centroid(geom) FROM zones;</code>',
   answer:'SELECT name, ST_Centroid(geom) FROM zones;',
   wrong:['SELECT name, geom FROM zones;','SELECT name, ST_AsText(ST_Centroid(geom)) FROM trails;'],
   check:need({reads:['zones'],calls:['st_centroid'],extra:c=>c.geoms().length>0||'Select the centroid itself, without <code>ST_AsText</code>, so the map can draw it.'})},

  {title:'What kind of shape?',
   goal:'A function can turn one kind of shape into another. Show <code>ST_GeometryType(geom)</code> and <code>ST_GeometryType(ST_Centroid(geom))</code> for the <code>Saltmarsh</code>.',
   anat:[['ST_GeometryType','fn','what kind of shape'],['geom','col','the marsh'],['ST_Centroid(geom)','fn','its middle']],
   how:['<code>SELECT ST_GeometryType(geom), ST_GeometryType(ST_Centroid(geom)) FROM zones WHERE name = \'Saltmarsh\';</code> names the kind of shape before and after <code>ST_Centroid</code>.',
     '<code>ST_GeometryType</code> returns the kind of a geometry as text, like <code>ST_Polygon</code>.',
     'The first column is the marsh itself, the second its centroid.',
     'You will see <code>ST_Polygon</code>, then <code>ST_Point</code>.'],
   explain:'When a table holds mixed shapes, <code>ST_GeometryType</code> tells them apart, for example in a <code>WHERE</code>: <code>WHERE ST_GeometryType(geom) = \'ST_Polygon\'</code>.',
   hint:'Call <code>ST_GeometryType</code> twice: on <code>geom</code> and on <code>ST_Centroid(geom)</code>.',
   answer:"SELECT ST_GeometryType(geom), ST_GeometryType(ST_Centroid(geom)) FROM zones WHERE name = 'Saltmarsh';",
   wrong:["SELECT ST_GeometryType(geom) FROM zones WHERE name = 'Saltmarsh';","SELECT 'ST_Polygon', 'ST_Point';"],
   check:need({reads:['zones'],calls:['st_geometrytype','st_centroid']})},

  {title:'Draw a shape',
   goal:'On the back of her note, Odile sketched a triangle on Windmill Hill with corners at <code>-40.05 35.03</code>, <code>-40.04 35.03</code> and <code>-40.045 35.04</code>. Make that polygon with SRID 4326 using <code>ST_GeomFromText</code>, and select it.',
   anat:[['ST_GeomFromText','fn','read WKT'],["'POLYGON((...))'",'val','three corners and the first again'],['4326','val','the SRID']],
   how:['<code>SELECT ST_GeomFromText(\'POLYGON((-40.05 35.03, -40.04 35.03, -40.045 35.04, -40.05 35.03))\', 4326);</code> makes Odile\'s triangle.',
     'Inside <code>POLYGON((...))</code> go the corners, each <code>x y</code>, separated by commas.',
     'The ring must close: after the three corners comes the first corner again, so the ring has four points.',
     '<code>4326</code> gives it the island\'s SRID, and the map draws it on the hill.'],
   explain:'Try it without the last point: PostGIS refuses a ring that does not close. The corners may go round either way, and you may start from any corner, as long as the ring closes.',
   hint:'Four points: the three corners, then <code>-40.05 35.03</code> again.',
   answer:"SELECT ST_GeomFromText('POLYGON((-40.05 35.03, -40.04 35.03, -40.045 35.04, -40.05 35.03))', 4326);",
   wrong:["SELECT ST_GeomFromText('POLYGON((-40.05 35.03, -40.04 35.03, -40.045 35.05, -40.05 35.03))', 4326);","SELECT ST_GeomFromText('POLYGON((-40.05 35.03, -40.04 35.03, -40.045 35.04, -40.05 35.03))');","SELECT ST_GeomFromText('LINESTRING(-40.05 35.03, -40.04 35.03, -40.045 35.04, -40.05 35.03)', 4326);"],
   check:c=>{
     if(!c.calls('st_geomfromtext'))return 'Make the shape with <code>ST_GeomFromText</code>.';
     const g=c.geoms().map(o=>o.g).find(g=>g.type==='Polygon');
     if(!g)return 'Your result has no polygon in it yet. Write <code>POLYGON((...))</code> and select the shape itself, without <code>ST_AsText</code>.';
     if(!REL.equals({...g,srid:0},TRI))return 'That polygon is not Odile\'s triangle. Check each corner against the goal.';
     if(g.srid!==4326)return 'The triangle is right, but its SRID is <code>'+g.srid+'</code>. Add <code>4326</code> as the second argument.';
     return true;}},
  ]});
})();
