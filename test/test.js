var test = require('tap').test
, tailsender = require('../index.js')
, net = require('net')
;

test("can send tail",function(t){

  var connected = 0,s;
  var server = net.createServer(function(con){
    connected++;
    con.on('data',function(buf){
      var o = JSON.parse(buf.toString());
      t.ok(o,'should have gotten json line from client');
      console.log(o);
      
      server.close(function(){
        s.end();
        t.end();
      });
    })
  });

  server.listen(0,function(){
    var address = server.address();
    s = tailsender(address.port);
    t.ok(s,'should get stream');
    
    s.write({interesting:1});
  });
});
