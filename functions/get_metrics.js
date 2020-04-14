let AWS = require("aws-sdk");

let cloudwatch = new AWS.CloudWatch({
	apiVersion: '2010-08-01',
	region: process.env.AWS_REGION || 'us-east-1'
});

//
//	This promise will get the CPU usage of the selected instance.
//
module.exports = function(instance_id) 
{
	return new Promise(function (resolve, reject) {

		console.info("get_stats - " + instance_id);

		//
		//	1.	Prepare the query.
		//
		let params = {
			EndTime: new Date(),
			StartTime: new Date(Date.now() - 1000 * 60 * 10),
			MetricName: 'CPUUtilization',
			Namespace: 'AWS/EC2',
			Period: '3600',
			Dimensions: [{
                Name: 'InstanceId',
                Value: instance_id
            }],
			Statistics: ["Maximum"],
		};

		//
		//	2.	Execute the query.
		//
		cloudwatch.getMetricStatistics(params, function (error, data) {

			//
			//	1.	Check for internal error.
			//	
			if(error)
			{
				return reject(error);
			}

			//
			//	2.	Mathe the data with the ID of the instance so we know
			//		to which instance the data belongs.
			//
			let result = {
				instance_id: instance_id,
				data: data
			}

			//
			//	->	Move to the next promise.
			//
			return resolve(result);

		});

	});
}