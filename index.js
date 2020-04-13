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
			//	Save the IDS that were passed when the stack got deployed.
			//
			tag: process.env.TAG,
			//
			//	Save the IDs in a organzied way.
			//
			instance_ids: [],
			//
			//	Callect all the promises which will be used to get the CPU
			//	usage for all the found instances.
			//
			promises_get_stats: [],
			//
			//	The stats for the CPUs.
			//
			metric: [],
			//
			//	Filtered Instacne IDs to be hibernated.
			//
			ids_to_hibernate: [],
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

				return get_all_stats(container);

			}).then(function (container) {

				return decision_maker(container);

			}).then(function (container) {

				return hibernate_instances(container);

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
					Values: [container.tag]
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
//	List all the EC2 instances based on a tag.
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

				//
				//	1.	For each instance prepare the promise that will take the
				//		the CPU stas.
				//
				container.promises_get_stats.push(get_stats(instance.InstanceId))

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
function get_all_stats(container)
{
	return new Promise(function (resolve, reject) {

		console.info("save_ec2_instance_ids");

		Promise.all(container.promises_get_stats)
			.then(function(result) {

				//
				//	1.	Save the resutl for the next promise.
				//	
				container.metric = result;

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
		container.metric.forEach(function(metric) {

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

		//
		//	->	Move to the next promise.
		//
		return resolve(container);

	});
}

//
//	Hibernate unused instances.
//
function hibernate_instances(container)
{
	return new Promise(function (resolve, reject) {

		//
		//	>>>	If there is nothing to hibernate 
		//
		if(!container.ids_to_hibernate.length)
		{
			return resolve(container);
		}

		console.info("hibernate_instances");

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