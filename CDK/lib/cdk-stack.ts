import * as cdk from '@aws-cdk/core';
import * as s3 from '@aws-cdk/aws-s3';
import * as s3deploy from '@aws-cdk/aws-s3-deployment';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as lambda from '@aws-cdk/aws-lambda';
import * as apigateway from '@aws-cdk/aws-apigateway';
import * as CustomResources from '@aws-cdk/custom-resources';
import { Pipeline } from '@aws-cdk/aws-codepipeline';
import { CodeBuildAction, GitHubSourceAction } from '@aws-cdk/aws-codepipeline-actions';
import { Artifact } from '@aws-cdk/aws-codepipeline/lib/artifact';
import { BuildSpec, LinuxBuildImage, PipelineProject } from '@aws-cdk/aws-codebuild';



export class CdkStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const frontendBucket = new s3.Bucket(this, 'CDKFrontend', {
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
    });

    const bucketDeploymennt = new s3deploy.BucketDeployment(this, 'DeployCDKFrontend', {
      sources: [s3deploy.Source.asset('../application/my-app/build/')],
      destinationBucket: frontendBucket
    });
    bucketDeploymennt.node.addDependency(frontendBucket);

    const todoItemsTable = new dynamodb.Table(this, 'TodoItems', {
      partitionKey: {
        name: 'lecture',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'lectureDate',
        type: dynamodb.AttributeType.STRING
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY
    })

    const sharedCodeLayer = new lambda.LayerVersion(this, 'TodoApplicationCode', {
      code: lambda.Code.fromAsset('../application/functions/shared-code'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_14_X]
    });


    const addItemLambda = new lambda.Function(this, 'TodoApplicationAddItemFunction', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../application/functions/add-item', { exclude: ["node_modules", "*.json"] }),
      environment: {
        TODO_ITEMS_TABLE_NAME: todoItemsTable.tableName,
        ALLOWED_ORIGINS: '*'
      },
      layers: [
        sharedCodeLayer
      ]
    })
    todoItemsTable.grantReadWriteData(addItemLambda)

    const getItemsLambda = new lambda.Function(this, 'TodoAppplicationGetItemsFunction', {
      runtime: lambda.Runtime.NODEJS_14_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../application/functions/get-item', { exclude: ["node_modules", "*.json"] }),
      environment: {
        TODO_ITEMS_TABLE_NAME: todoItemsTable.tableName,
        ALLOWED_ORIGINS: '*'
      },
      layers: [
        sharedCodeLayer
      ]
    });

    todoItemsTable.grantReadData(getItemsLambda)

    const apiGateway = new apigateway.RestApi(this, 'TodoApplicationApiGateway', {
      restApiName: 'TodoApplicationApi'
    })

    const itemResource = apiGateway.root.addResource('item')
    itemResource.addCorsPreflight({
      allowOrigins: ['*'],
      allowMethods: ['Get', 'Put']
    })

    itemResource.addMethod('PUT', new apigateway.LambdaIntegration(addItemLambda), {})
    itemResource.addMethod('GET', new apigateway.LambdaIntegration(getItemsLambda), {})

    const frontendConfig = {
      itemsApi: apiGateway.url,
      lastChanged: new Date().toUTCString()
    };

    const dataString = `window.AWSConfig = ${JSON.stringify(frontendConfig, null, 4)};`


    const putUpdate = {
      service: 'S3',
      action: 'putObject',
      parameters: {
        Body: dataString,
        Bucket: `${frontendBucket.bucketName}`,
        Key: 'config.js'
      },
      physicalResourceId: CustomResources.PhysicalResourceId.of(`${frontendBucket.bucketName}`)
    };
    const s3Upload = new CustomResources.AwsCustomResource(this, 'TodoApplicationSetConfigJS', {
      policy: CustomResources.AwsCustomResourcePolicy.fromSdkCalls({ resources: CustomResources.AwsCustomResourcePolicy.ANY_RESOURCE }),
      onUpdate: putUpdate,
      onCreate: putUpdate
    });
    s3Upload.node.addDependency(bucketDeploymennt);
    s3Upload.node.addDependency(apiGateway)

    // Pipeline

    const pipeline = new Pipeline(this, "EducasePipeline", {
      pipelineName: "Pipeline",
      crossAccountKeys: false,
    })

    const sourceOutput = new Artifact('SourceOutput');

    pipeline.addStage({
      stageName: "Source",
      actions: [
        new GitHubSourceAction({
          owner: 'Zanele-M',
          repo: 'educase',
          branch: 'main',
          actionName: 'Pipeline-Source',
          oauthToken: cdk.SecretValue.secretsManager('github'),
          output: sourceOutput
        })
      ]
    });

    const cdkBuildOutput = new Artifact('CdkBuildOutput');
    pipeline.addStage({
      stageName: "Build",
      actions: [
        new CodeBuildAction({
          actionName: 'Educase',
          input: sourceOutput,
          outputs: [cdkBuildOutput],
          project: new PipelineProject(this, 'CdkBuildProject', {
            environment: {
              buildImage: LinuxBuildImage.STANDARD_5_0
            },
            buildSpec: BuildSpec.fromSourceFilename('build-specs/cdk-build-spec.yml')
          })
        })]
    });
  }
}

function newDate() {
  throw new Error('Function not implemented.');
}

