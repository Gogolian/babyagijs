const Pinecone = require("@pinecone-database/pinecone");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Set API Keys
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY environment variable is missing from .env");

const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
if (!PINECONE_API_KEY) throw new Error("PINECONE_API_KEY environment variable is missing from .env");

const PINECONE_ENVIRONMENT = process.env.PINECONE_ENVIRONMENT || "us-east1-gcp";
const YOUR_TABLE_NAME = process.env.TABLE_NAME;
if (!YOUR_TABLE_NAME) throw new Error("TABLE_NAME environment variable is missing from .env");

const OBJECTIVE = process.argv[2] || process.env.OBJECTIVE;
if (!OBJECTIVE) throw new Error("OBJECTIVE environment variable is missing from .env");

const YOUR_FIRST_TASK = process.env.FIRST_TASK;
if (!YOUR_FIRST_TASK) throw new Error("FIRST_TASK environment variable is missing from .env");

const USE_GPT4 = process.env.USE_GPT4 || false;
if (USE_GPT4) {
    console.log('\x1b[91m%s\x1b[0m', "\n*****USING GPT-4. POTENTIALLY EXPENSIVE. MONITOR YOUR COSTS*****");
}

// Print OBJECTIVE
console.log("\x1b[96m\x1b[1m*****OBJECTIVE*****\n\x1b[0m\x1b[0m");
console.log(OBJECTIVE);

// Configure OpenAI and Pinecone
const openai = require("openai");
openai.api_key = OPENAI_API_KEY;

const pinecone = new Pinecone.PineconeClient();

// Create Pinecone index
const table_name = YOUR_TABLE_NAME;
const dimension = 1536;
const metric = "cosine";
const pod_type = "p1";

// Task list
const task_list = [];

function add_task(task) {
  task_list.push(task);
}

function get_ada_embedding(text) {
  text = text.replace("\n", " ");
  return openai.Embedding.create({ input: [text], model: "text-embedding-ada-002" })["data"][0]["embedding"];
}

async function openai_call(prompt, use_gpt4 = false, temperature = 0.5, max_tokens = 100) {
  if (!use_gpt4) {
    //Call GPT-3 DaVinci model
    const response = await openai.Completion.create({
      engine: "text-davinci-003",
      prompt: prompt,
      temperature: temperature,
      max_tokens: max_tokens,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });
    return response.choices[0].text.trim();
  } else {
    //Call GPT-4 chat model
    const messages = [{ role: "user", content: prompt }];
    const response = await openai.ChatCompletion.create({
      model: "gpt-4",
      messages,
      temperature,
      max_tokens,
      n: 1,
      stop: null,
    });
    return response.choices[0].message.content.trim();
  }
}

async function task_creation_agent(objective, result, task_description, task_list, gpt_version = 'gpt-3') {
  const prompt = `You are an task creation AI that uses the result of an execution agent to create new tasks with the following objective: ${objective}, The last completed task has the result: ${result}. This result was based on this task description: ${task_description}. These are incomplete tasks: ${task_list.join(', ')}. Based on the result, create new tasks to be completed by the AI system that do not overlap with incomplete tasks. Return the tasks as an array.`;
  const response = await openai_call(prompt, USE_GPT4);
  const new_tasks = response.split('\n').map(task_name => ({task_name}));
  return new_tasks;
}

async function prioritization_agent(this_task_id, gpt_version = 'gpt-3') {
  const task_names = task_list.map(t => t.task_name);
  const next_task_id = this_task_id + 1;
  const prompt = `You are an task prioritization AI tasked with cleaning the formatting of and reprioritizing the following tasks: ${task_names.join(', ')}. Consider the ultimate objective of your team: ${OBJECTIVE}. Do not remove any tasks. Return the result as a numbered list, like:
    1. First task
    2. Second task
    Start the task list with number ${next_task_id}.`;
  const response = await openai_call(prompt, USE_GPT4);
  const new_tasks = response.split('\n').map(task_string => {
    const [task_id, task_name] = task_string.trim().split('.', 2).map(x => x.trim());
    return {task_id, task_name};
  });
  task_list = [];
  for (const task of new_tasks) {
    task_list.push(task);
  }
}

async function execution_agent(objective, task, gpt_version = 'gpt-3') {
  const context = await context_agent(objective, YOUR_TABLE_NAME, 5);
  const prompt = `You are an AI who performs one task based on the following objective: ${objective}.\nTake into account these previously completed tasks: ${context}\nYour task: ${task}\nResponse:`;
  return await openai_call(prompt, USE_GPT4, 0.7, 2000);
}

async function context_agent(query, index, n) {
  const query_embedding = await get_ada_embedding(query);
  const indexClient = pinecone.Index(index);
  const results = await indexClient.query(query_embedding, {
    top_k: n,
    include_metadata: true
  });
  const sorted_results = results.matches.sort((a, b) => b.score - a.score);
  return sorted_results.map(result => result.metadata.task);
}

const first_task = {
  task_id: 1,
  task_name: YOUR_FIRST_TASK
};
add_task(first_task);

let task_id_counter = 1;

(async () => {

  await pinecone.init({
    apiKey: PINECONE_API_KEY,
    environment: PINECONE_ENVIRONMENT,
    projectName: 'Default Project'
  });

  const indexesList = await pinecone.listIndexes();
  if (!indexesList.includes(table_name)) {
    await pinecone.createIndex({
      createRequest: {
        name: table_name,
        dimension,
        metric,
        podType: pod_type,
      },
    });
  }

  while (true) {
    if (task_list.length > 0) {

      console.log("\n*****TASK LIST*****\n");

      for (const task of task_list) {
        console.log(`${task.task_id}: ${task.task_name}`);
      }

      const task = task_list.shift();
      console.log("\n*****NEXT TASK*****\n");
      console.log(`${task.task_id}: ${task.task_name}`);

      const result = await execution_agent(OBJECTIVE, task.task_name);
      const this_task_id = parseInt(task.task_id);
      console.log("\n*****TASK RESULT*****\n");
      console.log(result);

      // Step 2: Enrich result and store in Pinecone
      const enriched_result = {'data': result};  // This is where you should enrich the result if needed
      const result_id = `result_${task['task_id']}`;
      const vector = enriched_result['data'];  // extract the actual result from the dictionary
      index.upsert([
        {
          id: result_id,
          values: get_ada_embedding(vector),
          metadata: {
            task: task['task_name'],
            result: result
          }
        }
      ]);

      // Step 3: Create new tasks and reprioritize task list
      const new_tasks = task_creation_agent(OBJECTIVE, enriched_result, task["task_name"], task_list.map(t => t.task_name));

      for (const new_task of new_tasks) {
          task_id_counter++;
          new_task.task_id = task_id_counter;
          add_task(new_task);
      }
      prioritization_agent(this_task_id);

      await new Promise(resolve => setTimeout(resolve, 1000)); // Sleep before checking the task list again
    }
  }
})()
