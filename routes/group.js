var User = require('../model/user');
var Group = require('../model/group');
var Message = require('../model/message');
var async = require('async');
var ObjectId = require('mongoose').Types.ObjectId; 
var io = require('../socket');
var GroupSetting = require('../model/groupSetting');

exports.getGroups = function(req, res) {
  var usr = req.user;

  GroupSetting.find({'user': usr._id}, function(err, gses) {
    Group.find( { 'members' : usr._id })
      .populate('members', 'username')
      .exec(function(err, groups) {
	if (err) res.send(500, {'error' : 'There was an error getting groups!'});

	gses.forEach(function(gs) {
	  if (gs.deleted) {
	    var index = -1;
	    for (var i = 0; i < groups.length; i++) {
	      var g = groups[i];
	      if (g._id.equals(gs.group)) {
		index  = i;
		break;
	      }
	    }
	    if (index > -1) {
	      groups.splice(index, 1);
	    }
	  }
	});

	res.send(groups);
      });
  });

};

exports.createGroup = function(req, res) {
  var usr = req.user;

  console.log('BODY: ' + JSON.stringify(req.body, null, 4));
  
  var members = req.body.members;
  if (!members || !(members instanceof Array) || members.length == 0) {
    return res.send(400, {'error': 'The "members" value must be a valid array of length 1!'});
  }

  var message = req.body.text;
  if (!message) {
    return res.send(400, {'error': 'You must send a message with the new group!'});
  }


  var cb = function(err, group) {
    if (err) return res.send(400, {'error': err});
    res.send(201, group);
  };

  var name = req.body.name;

  User.find({'username': { $in: members } }, function(err, users) {
    if (err || users.length == 0) {
      return res.send(400, {'error': 'No users were found with those usernames!'});
    }

    var otherMembers = [];
    users.forEach(function(user) {
      if (!user._id.equals(usr._id)) {
	otherMembers.push(user);
      }
    });

    newGroup(name, otherMembers, message, usr, cb);
  });

};

function newGroup(groupName, members, message, creator, cb) {

  members.push(creator);

  Group.newGroup({'name': groupName, 'members': members}, function(err, group) {
    if (err) return cb(err);
    
    var aMessage = new Message({'from' : creator._id,
				'group': group._id,
				'text' : message,
				'sent' : new Date()
			       });

    aMessage.save(function(err) {
      group.messages.push(aMessage._id);
      group.save();

      ///
      /// Emit a new message to socket users
      ///
      var usersNotOn = [];
      members.forEach(function(user) {
	if ( !user._id.equals(creator._id) ) { //Don't emit to creator
	  var socket = io.socketForId(user._id);
	  if (socket) {
	    socket.emit('new_group', group);
	  } else {
	    usersNotOn.push(user);
	  }
	}
      });

      aMessage.fromUser = creator;
      usersNotOn.forEach(function(user) {
	user.push(aMessage);
      });


      cb(null, group);
    });
    
  });
};

// PUT /group/:id/leave
exports.leaveGroup = function(req, res) {

  var groupId = null;
  try {
    groupId = new ObjectId(req.params.id);
  } catch (err) {
    return res.send(400, {'error':'Group ID is not a valid ID!'});
  }

  var user = req.user;

  // To leave a group, we must:
  // put them in the leftMembers array in the group
  // remove them from the members array in the group
  // add the group to leftGroups in the profile
  // remove the group from groups in the profile
  // change the groupSetting flag to 'left'

  Group.findOne( { _id : groupId }, function(err, group) {
    if (group) {
      console.log('Finding: ' + JSON.stringify(user._id, null, 4));
      console.log('In: ' + JSON.stringify(group, null, 4));
      var index = group.members.indexOfEquals(user._id);
      console.log('Index1: ' + index);
      if (index > -1) { //The member is in the group

	async.parallel([
	  function(callback) {
	    // update group
	    group.members.splice(index, 1);
	    group.leftMembers.push(user._id);
	    group.save(function(err) {
	      callback(err);
	    });
	  },
	  function(callback){
	    // Update profile
	    var groupIndex = user.groups.indexOfEquals(groupId);
	    console.log('Index2: ' + groupIndex);
	    if (groupIndex > -1) {
	      user.groups.splice(groupIndex, 1);
	      user.leftGroups.push(groupId);
	      user.save(function(err) {
		callback(err);
	      });
	    } else {
	      callback();
	    }
	  },
	  function(callback){
	    // Update Group Setting
	    GroupSetting.findOne({'user': user._id, 'group': groupId}, function(err, gs) {
	      console.log('GS: ' + JSON.stringify(gs, null, 4));
	      if (gs) {
		gs.left = true;
		gs.save(function(err) {
		  callback(err);
		});
	      } else {
		callback();
	      }
	    });
	  },
	],
	// optional callback
	function(err, results) {
	  if (err) return res.send(400, {'error':err});

	  res.send(200, {});
	});

      } else { //Member is not in this group
	return res.send(404, {'error':'Group not found!'});
      }
    } else {
      return res.send(404, {'error':'Group not found!'});
    }
  });

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
