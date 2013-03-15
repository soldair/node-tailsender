
var through = require('through')
, Backoff = require('backoff')
, floody = require('floody')
, net = require('net')
;
// useage:
// (port)
// (host)
// (options)
// (port,host)
// (port,host,options)
// (port,options)
 
module.exports = function(opts){

  if(typeof opts == 'number'){
    opts = {port:opts};
  } else if(typeof opts == 'string'){
    opts = {host:opts};
  }

  if(typeof arguments[1] == 'string'){
    opts.host = arguments[1];
  } else if(typeof arguments[1] == 'object' && arguments[1]){
   opts = _ext(arguments[1],opts);
  }

  if(typeof arguments[2] == 'object' && arguments[2]){
   opts = _ext(arguments[1],opts);
  }

  var s = through();
  
  opts = _ext({
    logs:[],
    host:"localhost",
    port:5140,
    keepAlive:true,
    keepAliveInterval:10000,
    reconnectInitialTimeout:100,
    reconnectMaxInterval:30000,
    defaultLog:'default'
  },opts||{});

console.log(opts);

  var sender = new TailSender(s,opts);

  s.on('end',function(){
    sender.close();
  });

  s.on('data',function(data){

    console.log('data event in the house',data);

    sender.write(data)
  });

  s.writeLog = function(line,context,id){
    sender.write(line,context,id);
  }

  return s;
}

function TailSender(stream,options){
  this.stream = stream;
  this.options = options;
}

TailSender.prototype = {
  stream:false,
  options:false,
  i:0,
  buffer:'',
  bufferInfo:null,
  connection:false,
  connected:false,
  connect:function(){
    var z = this;

    if(z.connected) return;
    var opts = {host:z.options.host,port:z.options.port};
    if(!z.connection) {
      z.connected = false;
      z.connection = net.connect(opts.port,opts.host)
        
      z.connection.on('connect',function(err,data){
        if(z.buffer.length) {

          z.stream.emit('log',"info",'sending line buffer [',z.buffer.length,' bytes]');

          var buf = new Buffer(z.buffer);
          z.buffer = '';
          z._write(buf,z.bufferInfo);

          z.connected = true;

        } else {
          z.connected = true;
        }

        z.resumeTails();
      });

      if(z.options.keepAlive) z.connection.setKeepAlive(z.options.keepAlive,z.options.keepAliveInterval);

      z.connection.on('end',function(){
        z.pause();
        z.stream.emit('log',"info",'connection was closed.');
        z.connected = false;
        z.reconnect();  
      });

      z.connection.on('error',function(err){
        z.pause();
        z.stream.emit('log',"warning",'connection error. ',err.code,opts);
        z.connected = false;
        z.reconnect();
      });

      this.connection.on('drain',function(){
        z.resume();
      });
      
      this.floody = floody(this.connection,100,10240);
      this.floody.on('write',function(tailInfos,bytes){

        z.stream.emit('write',tailInfos,bytes);  
        if(!z.shouldPause()) z.resumeTails();

      });
    } else {
      //reconnect!
      this.connection.connect(opts.port,opts.host);
    } 
  },
  reconnect:function(){
    this.stream.emit('log','info','reconnect');
    var z = this;
    if(!this.backoff) {
      this.backoff = new Backoff({
        initialTimeout:this.options.reconnectInitialTimeout,
        maxTimeout:this.options.reconnectMaxInterval 
      });

      this.backoff.on('backoff',function(number,delay){

        if(z.connected) return z.backoff.reset();
        
        this.stream.emit('log','info','reconnect attempt ' + number + ' waited ' + delay + 'ms');
        if(!z.backoff.backoffInProgress){
          z.connect();
          z.backoff.backoff();
        }
      });

      this.backoff.on('error',function(err){
        z.stream.emit('log','warning','backoff error! ',err);
        z.backoff = null;
      });
    }

    if(!z.backoff.backoffInProgress){
      this.backoff.backoff();
    }
  },
  write:function(line,log,writeInfo,id){
    var z = this;
 
    line = z.format(line,log||'',id);
    if(z.connected) {
      console.log('connected?')
      z._write(line,writeInfo);
    } else {
      console.log('buffering line')
      this.pause();
      this.bufferLine(line,writeInfo);
    }
  },
  _write:function(line,writeInfo){
    var z = this;

    this.floody.write(line,writeInfo);

    if(z.shouldPause()) {
      z.pause();
    }
  },
  shouldPause:function(){
    return (this.options.maxSocketBufferSize||10240) < this.connection.bufferSize;
  },
  pause:function(){
    this.stream.pause();
  },
  resume:function(){
    this.stream.resume();
  },
  format:function(line,log,id){

    var obj = {time:Date.now(),line:line,file:log};
    if(id) obj.id = id;
    obj = JSON.stringify(obj)+"\n";

    return obj;
  },
  bufferLine:function(line,writeInfo){
    this.stream.emit('log','info','buffering '+line.length+' bytes');
    this.buffer += line;
    this.bufferInfo = writeInfo;
  },
  close:function(){
    this.connection.destroy();
    this.floody.stop();
    this.connection = null;
    var z = this;
  },
  _id:function(){
    return this.id+''+(++this.i);
  }
};

function _ext(o,o2){
  Object.keys(o2).forEach(function(k){
    o[k] = o2[k]; 
  });
  return o;
}

