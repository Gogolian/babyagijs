const { Configuration, OpenAIApi } = require("openai");

// Set API Keys
const OPENAI_API_KEY = "";

// Set Variables
const OBJECTIVE = "Solve world hunger.";
const YOUR_FIRST_TASK = "Develop a task list.";

// Print OBJECTIVE
console.log("\x1b[96m\x1b[1m" + "\n*****OBJECTIVE*****\n" + "\x1b[0m\x1b[0m");
console.log(OBJECTIVE);

// Configure OpenAI
const configuration = new Configuration({apiKey: OPENAI_API_KEY});
const openai = new OpenAIApi(configuration);

// Task list
const taskList = [];

function addTask(task) {
  taskList.push(task);
}

async function createTask(prompt) {
  const completion  = await openai.createCompletion({
    model: "text-davinci-003",
    prompt,
    temperature: 0.5,
    max_tokens: 100,
    top_p: 1,
  });
  return completion.data.choices[0].text.trim().split("\n");
}

async function taskCreationAgent(objective, result, taskDescription, taskList) {
  const prompt = `You are an task creation AI that uses the result of an execution agent to create new tasks with the following objective: ${objective}, The last completed task has the result: ${result}. This result was based on this task description: ${taskDescription}. These are incomplete tasks: ${taskList.join(
    ", "
  )}. Based on the result, create new tasks to be completed by the AI system that do not overlap with incomplete tasks. Return the tasks as an array.`;
  const newTasks = await createTask(prompt);
  return newTasks.map((taskName) => ({ task_name: taskName }));
}

async function prioritizationAgent(thisTaskId) {
  const taskNames = taskList.map((t) => t.task_name);
  const nextTaskId = thisTaskId + 1;
  const prompt = `You are an task prioritization AI tasked with cleaning the formatting of and reprioritizing the following tasks: ${taskNames}. Consider the ultimate objective of your team: ${OBJECTIVE}. Do not remove any tasks. Return the result as a numbered list, like:
    #. First task
    #. Second task
    Start the task list with number ${nextTaskId}.`;
  const newTasks = await createTask(prompt);
  taskList.length = 0;
  newTasks.forEach((taskString) => {
    const taskParts = taskString.trim().split(".", 1);
    if (taskParts.length === 2) {
      const taskId = parseInt(taskParts[0].trim(), 10);
      const taskName = taskParts[1].trim();
      taskList.push({ task_id: taskId, task_name: taskName });
    }
  });
}

async function executionAgent(objective, task) {
  const completion = await openai.createCompletion({
    model: "text-davinci-003",
    prompt: `You are an AI who performs one task based on the following objective: ${objective}. Your task: ${task}\nResponse:`,
    temperature: 0.7,
    max_tokens: 2000,
    top_p: 1,
  });
  return completion.data.choices[0].text.trim();
}

// Add the first task
const firstTask = {
  task_id: 1,
  task_name: YOUR_FIRST_TASK,
};

addTask(firstTask);

// Main loop
async function mainLoop() {
  let task_id_counter = 1;
  while (true) {
    if (taskList.length) {
      // Print the task list
      console.log("\x1b[95m\x1b[1m" + "\nTASK LIST\n" + "\x1b[0m\x1b[0m");
      taskList.forEach((t) => {
        console.log(t.task_id + ": " + t.task_name);
      });

      // Step 1: Pull the first task
      const task = taskList.shift();
      console.log(
        "\x1b[92m\x1b[1m" + "\n*****NEXT TASK*****\n" + "\x1b[0m\x1b[0m"
      );
      console.log(task.task_id + ": " + task.task_name);

      // Send to execution function to complete the task based on the context
      const result = await executionAgent(OBJECTIVE, task.task_name);
      const thisTaskId = task.task_id;
      console.log(
        "\x1b[93m\x1b[1m" + "\n*****TASK RESULT*****\n" + "\x1b[0m\x1b[0m"
      );
      console.log(result);

      // Step 2: Enrich result and store in Pinecone (Update this section once Pinecone JavaScript library is available)
      const enrichedResult = { data: result };

      // Step 3: Create new tasks and reprioritize task list
      const newTasks = await taskCreationAgent(
        OBJECTIVE,
        enrichedResult,
        task.task_name,
        taskList.map((t) => t.task_name)
      );

      for (const newTask of newTasks) {
        task_id_counter += 1;
        newTask.task_id = task_id_counter;
        addTask(newTask);
      }

      await prioritizationAgent(thisTaskId);

      // Sleep before checking the task list again
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      // Sleep if the task list is empty
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

mainLoop();