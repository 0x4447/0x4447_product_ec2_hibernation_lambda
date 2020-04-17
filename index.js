let AWS = require("aws-sdk");

let ec2 = new AWS.EC2({
	apiVersion: '2016-11-15',
	region: process.env.AWS_REGION || 'us-east-1'
});

//
//	Load promis that gose over the CPU metrics of all the instances.
//	
let get_stats = require("./functions/get_metrics");

//
//	This lambda will go over all the EC2 instance with a specific tag
//	get their metrics, and if the CPU is bellow 5%, it will hibernate them
//	to preserve costs.
//
exports.handler = (event) => {

	return new Promise(function (resolve, reject) {

		//
		//	1. This container holds all the data to be passed around the chain.
		//
		let container = {
			//
			//	Contains the detailed description of every instances with the
			//	matching tag.
			//
			described_instances: {},
			//
			//	Holds the Instances stats for the instacnes with hibernation 
			//	enabled.
			//
			get_stats_enabled: [],
			//
			//	Holds the Instances stats for the instacnes with hibernation 
			//	disabled.
			//
			get_stats_disabled: [],
			//
			//	Holds the metric for the hibernation enabled instances.
			//
			metric_enabled: [],
			//
			//	Holds the metric for the hibernation disabled instances.
			//
			metric_disabled: [],
			//
			//	Holds the IDs of the instances to be hibernated.
			//
			ids_to_hibernate: [],
			//
			//	Holds the IDs of the instances to be stoped.
			//
			ids_to_stop: [],
			//
			//	The default response for Lambda.
			//
			res: {
				message: "OK"
			}
		}

		//
		//	->	Start the chain.
		//
		list_ec2_instances(container)
			.then(function (container) {

				return save_ec2_instance_ids(container);

			}).then(function (container) {

				return get_stats_enabled(container);

			}).then(function (container) {

				return get_stats_disabled(container);

			}).then(function (container) {

				return decision_maker(container);

			}).then(function (container) {

				return instances_to_hibernate(container);

			}).then(function (container) {

				return instances_to_stop(container);

			}).then(function (container) {

				//
				//  ->  Send back the good news.
				//
				return resolve(container.res);

			}).catch(function (error) {

				//
				//	->	Stop and surface the error.
				//
				return reject(error);

			});
	});
};

//	 _____    _____     ____    __  __   _____    _____   ______    _____
//	|  __ \  |  __ \   / __ \  |  \/  | |_   _|  / ____| |  ____|  / ____|
//	| |__) | | |__) | | |  | | | \  / |   | |   | (___   | |__    | (___
//	|  ___/  |  _  /  | |  | | | |\/| |   | |    \___ \  |  __|    \___ \
//	| |      | | \ \  | |__| | | |  | |  _| |_   ____) | | |____   ____) |
//	|_|      |_|  \_\  \____/  |_|  |_| |_____| |_____/  |______| |_____/
//

//
//	List all the EC2 instances based on a tag.
//
function list_ec2_instances(container) 
{
	return new Promise(function (resolve, reject) {

		console.info("list_ec2_instances");

		//
		//	1.	Prepare the query.
		//
		let params = {
			Filters: [
				{
					Name: "tag:Hibernate",
					Values: ["true"]
				}
			]
		};

		//
		//	->	execute the query.
		//
		ec2.describeInstances(params, function (error, data) {

			//
			//	1.	Check for internal error.
			//	
			if(error)
			{
				return reject(error);
			}

			//	
			//	2.	Save the data for the next promise.
			//
			container.described_instances = data;

			//
			//	->	Move to the next promise.
			//
			return resolve(container);

		});

	});
}

//
//	Loop pver all the instances, and organize the arrays with the promise
//	based on the state of the hibernation, if it is enabled or not.
//
function save_ec2_instance_ids(container)
{
	return new Promise(function (resolve, reject) {

		console.info("save_ec2_instance_ids");

		//
		//	1.	Loop over all the Reservations
		//
		container.described_instances.Reservations.forEach(function(reservation) {

			//
			//	1.	Loop over all the Instances
			//
			reservation.Instances.forEach(function(instance) {

				if(instance.HibernationOptions.Configured)
				{
					container.get_stats_enabled.push(get_stats(instance.InstanceId))
				}

				if(!instance.HibernationOptions.Configured)
				{
					container.get_stats_disabled.push(get_stats(instance.InstanceId))
				}

			});

		});

		//
		//	->	Move to the next promise.
		//
		return resolve(container);

	});
}

//
//	Fire all the prepared prosmies to get the CPU stats.
//
function get_stats_enabled(container)
{
	return new Promise(function (resolve, reject) {

		console.info("get_stats_enabled");

		Promise.all(container.get_stats_enabled)
			.then(function(result) {

				//
				//	1.	Save the resutl for the next promise.
				//	
				container.metric_enabled = result;

				//
				//	->	Move to the next promise.
				//
				return resolve(container);

			}).catch(function(error) {

				return reject(error);

			});

	});
}

//
//	Fire all the prepared prosmies to get the CPU stats.
//
function get_stats_disabled(container)
{
	return new Promise(function (resolve, reject) {

		console.info("get_stats_disabled");

		Promise.all(container.get_stats_disabled)
			.then(function(result) {

				//
				//	1.	Save the resutl for the next promise.
				//	
				container.metric_disabled = result;

				//
				//	->	Move to the next promise.
				//
				return resolve(container);

			}).catch(function(error) {

				return reject(error);

			});

	});
}

//
//	Based on the stats that we got back we have to decide which instance will
//	be hibernated, by adding the ID to a spacial array.
//
function decision_maker(container)
{
	return new Promise(function (resolve, reject) {

		console.info("decision_maker");

		//
		//	1.	Loop over all the metrics
		//
		container.metric_enabled.forEach(function(metric) {

			//
			//	1.	Check if there is something to work with.
			//
			if(metric.data.Datapoints[0])
			{
				//
				//	1.	Check if the CPU is bellow the thresh hold.
				//
				if(metric.data.Datapoints[0].Maximum < 5)
				{
					//
					//	1.	Add the Instance ID to the final array that will
					//		be useded to hiberante.
					//
					container.ids_to_hibernate.push(metric.instance_id)
				}
			}

		});

		container.metric_disabled.forEach(function(metric) {

			//
			//	1.	Check if there is something to work with.
			//
			if(metric.data.Datapoints[0])
			{
				//
				//	1.	Check if the CPU is bellow the thresh hold.
				//
				if(metric.data.Datapoints[0].Maximum < 5)
				{
					//
					//	1.	Add the Instance ID to the final array that will
					//		be useded to hiberante.
					//
					container.ids_to_stop.push(metric.instance_id)
				}
			}

		});

		//
		//	->	Move to the next promise.
		//
		return resolve(container);

	});
}

//
//	Hibernate unused instances.
//
function instances_to_hibernate(container)
{
	return new Promise(function (resolve, reject) {

		//
		//	>>>	If there is nothing to hibernate 
		//
		if(!container.ids_to_hibernate.length)
		{
			return resolve(container);
		}

		console.info("instances_to_hibernate");

		//
		//	1. Prepare the query.
		//
		let params = {
			InstanceIds: container.ids_to_hibernate,
			Hibernate: true
		};

		//
		//	2.	Execute the query.
		//
		ec2.stopInstances(params, function (error, data) {
			
			//
			//	1.	Check for internal error.
			//	
			if(error)
			{
				return reject(error);
			}

			//
			//	->	Move to the next promise.
			//
			return resolve(container);

		});

	});
}

//
//	Stop unused instances.
//
function instances_to_stop(container)
{
	return new Promise(function (resolve, reject) {

		//
		//	>>>	If there is nothing to stop 
		//
		if(!container.ids_to_stop.length)
		{
			return resolve(container);
		}

		console.info("instances_to_stop");

		//
		//	1. Prepare the query.
		//
		let params = {
			InstanceIds: container.ids_to_stop,
			Hibernate: false
		};

		//
		//	2.	Execute the query.
		//
		ec2.stopInstances(params, function (error, data) {
			
			//
			//	1.	Check for internal error.
			//	
			if(error)
			{
				return reject(error);
			}

			//
			//	->	Move to the next promise.
			//
			return resolve(container);

		});

	});
}