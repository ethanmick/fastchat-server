var User = require('../model/user');
var Group = require('../model/group');
var async = require('async');
var ObjectId = require('mongoose').Types.ObjectId; 

exports.getGroups = function(req, res) {
  var usr = req.user;
  Group.find( { 'members' : usr._id })
    .populate('members', 'username')
    .exec(function(err, groups) {
      if (err) res.send(500, {'error' : 'There was an error getting groups!'});
      res.send(groups);
    });

};

exports.createGroup = function(req, res) {
  User.fromToken( req.headers['session-token'], function (usr) {
    
    Group.newGroup(req.body, usr, function(err, group) {
      if (err) return res.send(400, {error: err});

      res.send(group);	       
    });
  });
};

exports.deleteGroup = function(req, res) {

};

exports.changeSettings = function(req, res) {

};

exports.invite = function(req, res) {
  console.log('Invite Body: ' + JSON.stringify(req.body, null, 4));
  
  var invites = req.body.invitees;
  var groupId = req.params.id;

  if (typeof groupId === 'undefined') {
    return res.send(400, {'error' : 'groupId cannot be undefined!'});
  }

  if (invites.length == 0) {
    return res.send(200);
  }

  Group.findOne( { _id : new ObjectId(groupId) }, function(err, group) {
    if (err || !group) return res.send(400, {'error' : 'Group was not found!'});

    console.log('Found Group: ' + JSON.stringify(group, null, 4));
    async.each(invites, function(username, cb) {
      User.findOne( { 'username': username.toLowerCase() }, function (err, usr) {
	console.log('Found User: ' + JSON.stringify(usr, null, 4));
	if (usr) {
	  
	  group.invites.push(usr._id);
	  group.save(function (err) {
	    if (err) return cb(err);
	    //if error?

	    usr.invites.push(group._id);
	    usr.save( function (err) {
	      if (err) return cb(err);
	      cb();
	    });
	  });
	} else {
	  cb();
	}
      });    
    }, function(err){
      if (err) res.send(400);
      res.send(200);
    });
  });
};

exports.uninvite = function(req, res) {

  var uninvites = req.body.uninvites;
  var groupId = req.params.id;

  if (typeof groupId === 'undefined') {
    return res.send(400, {'error' : 'groupId cannot be undefined!'});
  }

  if (uninvites.length == 0) {
    return res.send(200);
  }

  console.log('Group ID: ' + groupId);
  
  Group.findOne( { _id : new ObjectId(groupId) }, function(err, group) {
    console.log('Err: ' + err + ' Group: ' + JSON.stringify(group, null, 4));

    if (err || !group) return res.send(400, {'error' : 'Group was not found!'});
    
    async.each(uninvites, function(username, cb) {
    
      User.findOne( { 'username': username }, function (err, usr) {
	if (usr) {
	  var index = group.members.indexOf(usr._id);
	  if (index !== -1) {
	    group.members.splice(index, 1);
	  }

	  group.save(function(err) {

	    var groupIndex = user.groups.indexOf(group._id);
	    var inviteIndex = user.invites.indexOf(group._id);
	   
	    if (groupIndex !== -1) {
	      user.groups.splice(groupIndex, 1);
	    }

	    if (inviteIndex !== -1) {
	      user.invites.splice(inviteIndex, 1);
	    }

	    user.save( function (err) {
	      cb();
	    });
	  });
	} else {
	  cb();
	}
      });    
    }, function(err){
      if (err) res.send(400);
      res.send(200);
    });
  });
};
