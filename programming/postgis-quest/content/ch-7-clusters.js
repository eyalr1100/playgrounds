/* PostGIS Quest chapter 7: clusters. Window functions with OVER (), ST_ClusterKMeans, WITH, ST_ClusterDBSCAN with named
   settings and its noise (NULL), the centre of the biggest cluster, and the treasure: the well nearest that centre.
   Cluster numbers are labels, so cluster checks compare which rows share a number, never the numbers. DOM-free. */
(()=>{
'use strict';
const PQ=globalThis.PQ=globalThis.PQ||{};
const need=PQ.need;
const DB="ST_ClusterDBSCAN(geom, eps := 0.01, minpoints := 3) OVER ()";
PQ.CH.push({
  name:'Clusters',badge:'Compass Rose',
  story:'Odile\'s last clue says her Compass Rose lies "where my stones gather thickest". Group the clue stones into clusters, find the centre of the thickest one, and dig at the well nearest to it.',
  intro:'Twenty clue stones lie around the island in the table <code>stones</code>. Some sit in tight groups, a few stand alone. <b>Clustering</b> sorts rows into groups by where they are, with no group names given beforehand. PostGIS has two ways to do it, and both are <b>window functions</b>: they look at all the rows at once, then give each row its own answer.',
  learned:['ST_ClusterKMeans(geom, 3) OVER ()','WITH c AS (...) SELECT ... FROM c','ST_ClusterDBSCAN(geom, eps := 0.01, minpoints := 3) OVER ()','WHERE cid IS NULL','ORDER BY w.geom <-> centre.geom LIMIT 1'],
  missions:[
  {title:'Three groups: ST_ClusterKMeans',
   goal:'Split the stones into 3 groups: show each stone\'s <code>id</code> and <code>ST_ClusterKMeans(geom, 3) OVER ()</code>, named <code>cid</code>.',
   anat:[['ST_ClusterKMeans','fn','split into k groups'],['geom','col','each stone'],['3','val','how many groups'],['OVER ()','kw','look at all the rows'],['AS cid','al','the cluster number']],
   how:['<code>SELECT id, ST_ClusterKMeans(geom, 3) OVER () AS cid FROM stones;</code> gives every stone the number of its group: 0, 1 or 2.',
     '<code>ST_ClusterKMeans(geom, 3)</code> splits the rows into 3 groups, each around its own centre, so that every stone is near its group\'s centre.',
     '<code>OVER ()</code> makes it a <b>window function</b>: it sees every row at once, yet each row keeps its own line and gets its own answer.',
     'The map colours each stone by its <code>cid</code>, so you can see the three groups.'],
   explain:'K-means always makes exactly as many groups as you ask for, so even a lonely stone joins the nearest group. The numbers are only labels: another database may call the same group 2 where this one says 0.',
   hint:'<code>SELECT id, ST_ClusterKMeans(geom, 3) OVER () AS cid FROM stones;</code>',
   answer:'SELECT id, ST_ClusterKMeans(geom, 3) OVER () AS cid FROM stones;',
   wrong:['SELECT id, ST_ClusterKMeans(geom, 2) OVER () AS cid FROM stones;','SELECT id, ST_ClusterKMeans(geom, 4) OVER () AS cid FROM stones;','SELECT id, mark FROM stones;'],
   check:need({reads:['stones'],calls:['st_clusterkmeans'],has:['over'],partition:'id',tip:'Give every stone its group number from <code>ST_ClusterKMeans(geom, 3) OVER ()</code>, next to its <code>id</code>.'})},

  {title:'Name a query: WITH',
   goal:'How many stones are in each k-means group? Name the last query <code>c</code> with <code>WITH c AS (...)</code>, then count its rows per <code>cid</code>.',
   anat:[['WITH','kw','first make'],['c','al','a named result'],['AS (...)','kw','from this query'],['SELECT cid, count(*) FROM c','kw','then read it'],['GROUP BY cid','kw']],
   how:['<code>WITH c AS (SELECT ST_ClusterKMeans(geom, 3) OVER () AS cid FROM stones) SELECT cid, count(*) FROM c GROUP BY cid;</code> counts the stones in each group.',
     '<code>WITH c AS (...)</code> runs the query in brackets first and names its result <code>c</code>.',
     'The main query then reads <code>c</code> as if it were a table.',
     'You need the two steps: a window function cannot go inside <code>GROUP BY</code> or <code>WHERE</code> of the same query.'],
   explain:'Try <code>WHERE ST_ClusterKMeans(geom, 3) OVER () = 0</code> and the database says <code>window functions are not allowed in WHERE</code>: windows are worked out after <code>WHERE</code> and <code>GROUP BY</code>. <code>WITH</code> is the way round it, and it makes long queries easier to read, too.',
   hint:'<code>WITH c AS (SELECT ST_ClusterKMeans(geom, 3) OVER () AS cid FROM stones) SELECT cid, count(*) FROM c GROUP BY cid;</code>',
   answer:'WITH c AS (SELECT ST_ClusterKMeans(geom, 3) OVER () AS cid FROM stones) SELECT cid, count(*) FROM c GROUP BY cid;',
   wrong:['SELECT count(*) FROM stones;','WITH c AS (SELECT ST_ClusterKMeans(geom, 2) OVER () AS cid FROM stones) SELECT cid, count(*) FROM c GROUP BY cid;','SELECT mark, count(*) FROM stones GROUP BY mark;'],
   check:need({reads:['stones'],calls:['st_clusterkmeans','count'],has:['with','group'],extra:c=>{
     const n=c.cols.findIndex(x=>x.name==='count');
     if(n<0)return 'Count each group with <code>count(*)</code>.';
     const got=c.rows.map(r=>r[n]).sort((a,b)=>a-b).join(','),want=PQ.reference(PQ.CH[6].missions[1].answer).rows.map(r=>r[1]).sort((a,b)=>a-b).join(',');
     return got===want||'Count the stones per <code>cid</code>: one row per group.';}})},

  {title:'Thick spots: ST_ClusterDBSCAN',
   goal:'K-means forced the lonely stones into groups. DBSCAN does not: show each stone\'s <code>id</code> and <code>'+DB+'</code> as <code>cid</code>.',
   anat:[['ST_ClusterDBSCAN','fn','groups by how close'],['eps := 0.01','val','how near is a neighbour'],['minpoints := 3','val','how many make a group'],['OVER ()','kw']],
   how:['<code>SELECT id, '+DB+' AS cid FROM stones;</code> groups the stones that stand close together, and leaves the loners out.',
     '<code>eps := 0.01</code> says two stones within 0.01 degrees are neighbours. <code>:=</code> names a setting, so you need not remember the order.',
     '<code>minpoints := 3</code> says a stone with at least 3 stones within reach (itself included) starts a group, and its neighbours join it.',
     'Stones in no group get <code>NULL</code> in <code>cid</code>: no number at all. The map draws them grey.'],
   explain:'DBSCAN finds as many groups as the data has, and calls the rest <b>noise</b>. It suits "where do things gather thickest?", which is exactly Odile\'s riddle.',
   hint:'<code>SELECT id, '+DB+' AS cid FROM stones;</code>',
   answer:'SELECT id, '+DB+' AS cid FROM stones;',
   wrong:['SELECT id, ST_ClusterDBSCAN(geom, eps := 0.1, minpoints := 3) OVER () AS cid FROM stones;','SELECT id, ST_ClusterKMeans(geom, 3) OVER () AS cid FROM stones;','SELECT id, ST_ClusterDBSCAN(geom, eps := 0.01, minpoints := 8) OVER () AS cid FROM stones;'],
   check:need({reads:['stones'],calls:['st_clusterdbscan'],has:['over'],partition:'id',tip:'Use <code>eps := 0.01</code> and <code>minpoints := 3</code>, and show each stone\'s <code>id</code> next to its <code>cid</code>.'})},

  {title:'The loners',
   goal:'Captain Brack says the lonely stones are fakes he planted. Find them: put the DBSCAN query in <code>WITH c AS (...)</code> (with <code>id</code> and <code>mark</code> too), and keep the rows where <code>cid IS NULL</code>.',
   anat:[['WITH c AS (...)','kw'],['WHERE','kw'],['cid','col'],['IS NULL','kw','has no value']],
   how:['<code>WITH c AS (SELECT id, mark, '+DB+' AS cid FROM stones) SELECT id, mark FROM c WHERE cid IS NULL;</code> lists the stones DBSCAN left out of every group.',
     'The <code>WITH</code> part gives every stone its <code>cid</code>, as in the last mission.',
     '<code>cid IS NULL</code> is true when <code>cid</code> has no value.',
     'Two stones are left: the Captain\'s fakes.'],
   explain:'<code>cid = NULL</code> does not work: comparing with "no value" gives "unknown", never true, so no row passes. <code>IS NULL</code> and <code>IS NOT NULL</code> are the way to test for it.',
   hint:'<code>WITH c AS (SELECT id, mark, '+DB+' AS cid FROM stones) SELECT id, mark FROM c WHERE cid IS NULL;</code>',
   answer:'WITH c AS (SELECT id, mark, '+DB+' AS cid FROM stones) SELECT id, mark FROM c WHERE cid IS NULL;',
   wrong:['WITH c AS (SELECT id, mark, '+DB+' AS cid FROM stones) SELECT id, mark FROM c WHERE cid = NULL;','WITH c AS (SELECT id, mark, '+DB+' AS cid FROM stones) SELECT id, mark FROM c WHERE cid IS NOT NULL;','SELECT id, mark FROM stones WHERE id >= 19;'],
   check:need({reads:['stones'],calls:['st_clusterdbscan'],has:['with'],extra:c=>c.op('is null')||'Keep the stones with no group: <code>WHERE cid IS NULL</code>.'})},

  {title:'The thickest gathering',
   goal:'Find the biggest DBSCAN group and its centre. From <code>c</code> (with <code>cid</code> and <code>geom</code>), keep <code>cid IS NOT NULL</code>, group by <code>cid</code>, and show <code>cid</code>, <code>count(*) AS n</code> and <code>ST_Centroid(ST_Collect(geom)) AS centre</code> for the biggest group only.',
   anat:[['count(*) AS n','fn','stones in the group'],['ST_Centroid(ST_Collect(geom))','fn','the group\'s middle'],['IS NOT NULL','kw','no loners'],['ORDER BY n DESC LIMIT 1','kw','the biggest']],
   how:['<code>WITH c AS (SELECT '+DB+' AS cid, geom FROM stones) SELECT cid, count(*) AS n, ST_Centroid(ST_Collect(geom)) AS centre FROM c WHERE cid IS NOT NULL GROUP BY cid ORDER BY n DESC LIMIT 1;</code> finds the thickest group and its middle.',
     '<code>WHERE cid IS NOT NULL</code> drops the loners before grouping.',
     '<code>GROUP BY cid</code> makes one row per group, with its size <code>n</code> and its centre.',
     '<code>ORDER BY n DESC LIMIT 1</code> keeps the biggest: seven stones in the south of the island.'],
   explain:'The same pattern (cluster, group, summarise) turns any pile of points into "the busy places": crime hotspots, popular stops, bird colonies.',
   hint:'Group the <code>WITH</code> result by <code>cid</code>, sort by <code>n DESC</code> and keep one row.',
   answer:'WITH c AS (SELECT '+DB+' AS cid, geom FROM stones) SELECT cid, count(*) AS n, ST_Centroid(ST_Collect(geom)) AS centre FROM c WHERE cid IS NOT NULL GROUP BY cid ORDER BY n DESC LIMIT 1;',
   wrong:['WITH c AS (SELECT '+DB+' AS cid, geom FROM stones) SELECT cid, count(*) AS n, ST_Centroid(ST_Collect(geom)) AS centre FROM c GROUP BY cid ORDER BY n DESC LIMIT 1;','WITH c AS (SELECT '+DB+' AS cid, geom FROM stones) SELECT cid, count(*) AS n, ST_Centroid(ST_Collect(geom)) AS centre FROM c WHERE cid IS NOT NULL GROUP BY cid ORDER BY n LIMIT 1;','WITH c AS (SELECT ST_ClusterKMeans(geom, 3) OVER () AS cid, geom FROM stones) SELECT cid, count(*) AS n, ST_Centroid(ST_Collect(geom)) AS centre FROM c GROUP BY cid ORDER BY n DESC LIMIT 1;'],
   check:need({reads:['stones'],calls:['st_clusterdbscan','st_centroid','st_collect'],has:['with','group','order','limit'],extra:c=>{
     const want=PQ.reference(PQ.CH[6].missions[4].answer),g=c.geoms();
     // here the loners are too few to win, but a group of NULLs is no gathering: the lesson is to drop them first
     if(!c.op('is not null'))return 'Drop the loners before grouping, with <code>WHERE cid IS NOT NULL</code>: they are no gathering at all.';
     if(c.rows.length!==1)return 'Keep only the biggest group: <code>ORDER BY n DESC LIMIT 1</code>.';
     if(!g.length)return 'Show the centre itself, <code>ST_Centroid(ST_Collect(geom))</code>, so the map can draw it.';
     return PQ.vkey(g[0].g)===PQ.vkey(want.rows[0][2])||'That is not the centre of the biggest group. Did you leave out the loners with <code>cid IS NOT NULL</code>?';}})},

  {title:'Dig here',
   goal:'The treasure is at the well nearest the centre of the thickest gathering. Add the last query as a second named result, <code>centre</code>, and show the name of the one well nearest to it with <code>&lt;-&gt;</code>.',
   anat:[['WITH c AS (...),','kw','the clusters'],['centre AS (...)','kw','the biggest one\'s middle'],['FROM wells w, centre','tbl'],['ORDER BY w.geom <-> centre.geom','op','nearest first'],['LIMIT 1','kw']],
   how:['The full query names two results with <code>WITH</code>, then pairs every well with the centre and keeps the nearest one.',
     '<code>WITH c AS (...), centre AS (...)</code> names two results, separated by a comma; the second may read the first.',
     '<code>centre</code> is the last mission\'s query, keeping just its point as <code>geom</code>.',
     '<code>FROM wells w, centre ORDER BY w.geom &lt;-&gt; centre.geom LIMIT 1</code> pairs every well with that one point and keeps the nearest.'],
   explain:'You have just chained everything Gullhaven taught: clustering with a window function, <code>WITH</code>, grouping, a centroid of a collection and a nearest-neighbour search. That is a real spatial analysis, written in one query.',
   hint:'<code>WITH c AS (SELECT '+DB+' AS cid, geom FROM stones), centre AS (SELECT ST_Centroid(ST_Collect(geom)) AS geom FROM c WHERE cid IS NOT NULL GROUP BY cid ORDER BY count(*) DESC LIMIT 1) SELECT w.name FROM wells w, centre ORDER BY w.geom &lt;-&gt; centre.geom LIMIT 1;</code>',
   answer:'WITH c AS (SELECT '+DB+' AS cid, geom FROM stones), centre AS (SELECT ST_Centroid(ST_Collect(geom)) AS geom FROM c WHERE cid IS NOT NULL GROUP BY cid ORDER BY count(*) DESC LIMIT 1) SELECT w.name FROM wells w, centre ORDER BY w.geom <-> centre.geom LIMIT 1;',
   wrong:["SELECT name FROM wells WHERE name = 'Wishing Well';",'WITH c AS (SELECT '+DB+' AS cid, geom FROM stones), centre AS (SELECT ST_Centroid(ST_Collect(geom)) AS geom FROM c WHERE cid IS NOT NULL GROUP BY cid ORDER BY count(*) LIMIT 1) SELECT w.name FROM wells w, centre ORDER BY w.geom <-> centre.geom LIMIT 1;',"SELECT w.name FROM wells w, places p WHERE p.name = 'Old Oak' ORDER BY w.geom <-> p.geom LIMIT 1;"],
   check:need({reads:['stones','wells'],calls:['st_clusterdbscan','st_centroid'],has:['with','order','limit'],tip:'That is a well, but not the one nearest the centre of the thickest gathering. Check that <code>centre</code> keeps the biggest group (<code>ORDER BY count(*) DESC</code>).'})},
  ]});
})();
