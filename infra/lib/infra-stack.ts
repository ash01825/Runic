import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';

import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // S3 bucket for storing artifacts
        const artifactBucket = new s3.Bucket(this, 'OpsFlowArtifactBucket', {
            bucketName: 'opsflow-artifacts-12102025', // Must be globally unique
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            versioned: true,
        });

        // DynamoDB table for storing incident metadata
        const incidentTable = new dynamodb.Table(this, 'OpsFlowIncidents', {
            tableName: 'OpsFlowIncidents',
            partitionKey: { name: 'incidentId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // SNS topic for incident alerts or notifications
        const alertTopic = new sns.Topic(this, 'OpsFlowAlertTopic', {
            topicName: 'opsflow-alerts',
            displayName: 'OpsFlow Alerts Topic',
        });

        // SQS queue to buffer incoming incidents
        const opsQueue = new sqs.Queue(this, 'OpsFlowQueue', {
            queueName: 'opsflow-queue',
            visibilityTimeout: cdk.Duration.seconds(300),
            retentionPeriod: cdk.Duration.days(4),
        });

        // Lambda function to normalize incoming alert data before pushing to SQS
        const alertNormalizerLambda = new NodejsFunction(this, 'AlertNormalizerFunction', {
            functionName: 'opsflow-alert-normalizer',
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../lambdas/alert_normalizer/index.js'),
            projectRoot: path.join(__dirname, '../../'),
            depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
            bundling: {
                nodeModules: ['aws-sdk'], // Use AWS SDK provided by the runtime
            },
            environment: {
                QUEUE_URL: opsQueue.queueUrl,
            },
            timeout: cdk.Duration.seconds(10),
        });

        // Allow the Lambda to send messages to the queue
        opsQueue.grantSendMessages(alertNormalizerLambda);

        // Outputs for visibility in CloudFormation/console
        new cdk.CfnOutput(this, 'S3BucketName', { value: artifactBucket.bucketName });
        new cdk.CfnOutput(this, 'DynamoTableName', { value: incidentTable.tableName });
        new cdk.CfnOutput(this, 'SnsTopicArn', { value: alertTopic.topicArn });
        new cdk.CfnOutput(this, 'SqsQueueUrl', { value: opsQueue.queueUrl });
        new cdk.CfnOutput(this, 'LambdaFunctionName', { value: alertNormalizerLambda.functionName });
    }
}
