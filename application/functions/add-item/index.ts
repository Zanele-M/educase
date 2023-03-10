import { TodoItem } from '/opt/nodejs/todoitem';

const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

const todoItemsTable: string = process.env.TODO_ITEMS_TABLE_NAME as string;
const allowedOrigins: string = process.env.ALLOWED_ORIGINS as string;

export async function handler(event: any, context: any): Promise<any> {
    if (event.requeustContext?.authorizer?.claims?.email) {
        var requestBody = JSON.parse(event.body);
        var todoitem = new TodoItem()
        todoItem.what = requestBody.what
        todoitem.who = event.requeustContext.authorizer.claims.email
        todoitem.creationDate = new Date().toUTCString()
        return dynamodb.put({
            TableName : todoItemsTable,
            Item: todoItem,
        }).promise()
            .then(() => {
                return createJSONResponse(200, allowedOrigins, 'Order created')
            })
            .catch((err: any) => {
                console.error(err);
                return createJSONResponse(500, allowedOrigins, err.message)
            });
    } else {
        return createJSONResponse(400, allowedOrigins, 'No principal found')
    }
}
export const createJSONResponse = (statusCode: number, allowedOrigin: string, body: any): {} => {
    return {
        statusCode: statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': allowedOrigin
        },
        body: JSON.stringify(body)
    }
}

