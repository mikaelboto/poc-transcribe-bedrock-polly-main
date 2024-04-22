// Import the required AWS SDK clients and commands for Node.js
import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand } from "@aws-sdk/client-transcribe";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import {BedrockRuntimeClient, InvokeModelCommand} from '@aws-sdk/client-bedrock-runtime'
import { PollyClient, StartSpeechSynthesisTaskCommand } from "@aws-sdk/client-polly";

const region = 'us-east-1'
const transcribeClient = new TranscribeClient({ region });
const s3Client = new S3Client({region})
const bedrockClient = new BedrockRuntimeClient({region});
const pollyClient = new PollyClient({region})

const outputBucket = "rhevolut-poc-kxc-output"

export async function handler (event, context) {
  console.log('event', event)
  // const mediaFileUri = "https://rhevolut-poc-kxc.s3-us-east-1.amazonaws.com/teste2.ogg"
  const body = JSON.parse(event.body)
  const mediaFileUri = body.s3URL

  console.time('Transcribe')
  const transcribedText = await transcribe(mediaFileUri)
  console.timeEnd('Transcribe')

  // const transcribedText = await transcribeFake(mediaFileUri) 
  console.time('Bedrock')
  const bedrockResponse = await bedrock(transcribedText)
  console.timeEnd('Bedrock')
  const responseToUser = /<solicitacao>(.*?)<\/solicitacao>/g.exec(bedrockResponse)[1];
  
  if(!responseToUser){
    return {
      statusCode: 200,
      body: JSON.parse({
        responses: bedrockResponse,
        audioResponse: null
      })
    }
  }

  console.time('Polly')
  const audioFilePath = await  polly(responseToUser)
  console.timeEnd('Polly')

  return {
    statusCode: 200,
    body: JSON.parse({
      responses: bedrockResponse,
      audioResponse: audioFilePath
    })
  }
}

async function transcribeFake(mediaFileUri){
    // return `é uma vaga de desenvolvedor de software em regime remoto para uma empresa que trabalha na área da saúde desenvolvendo software para clínicas médicas. O nível de senioridade esperado é de mais de sete anos de experiência.`
    return `é uma vaga de desenvolvedor de software para uma empresa que trabalha na área da saúde desenvolvendo software para clínicas médicas. O nível de senioridade esperado é de mais de sete anos de experiência.`
}

async function transcribe(mediaFileUri){
  try {
    console.log("Starting Transcribe Job...")

    const fileName = `teste-${Date.now().toString()}`
    const startJobResponse = await transcribeClient.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: fileName,
        LanguageCode: "pt-BR", // For example, 'en-US'
        MediaFormat: "ogg", // For example, 'wav'
        Media: {
          MediaFileUri: mediaFileUri,
        },
        OutputBucketName: outputBucket
      })
    );

    console.log("startJobResponse", startJobResponse);
    
    const jobName = startJobResponse.TranscriptionJob.TranscriptionJobName
    
    let maxTries = 60

    while(maxTries > 0){
        maxTries -= 1

        const getJobResponse = await transcribeClient.send(new GetTranscriptionJobCommand({
          TranscriptionJobName: jobName
        }))
       
        const status = getJobResponse.TranscriptionJob.TranscriptionJobStatus

        if (status === 'COMPLETED' || status === 'FAILED'){
          // console.log(`Job ${jobName} is ${status}.`)

          console.log(`...`)

          const key = `${fileName}.json`
          if(status == "COMPLETED"){
            const getObjectResponse = await s3Client.send(new GetObjectCommand({
                Bucket: outputBucket,
                Key: key
            }))
            const bodyString = await getObjectResponse.Body.transformToString()

            const transcribeResponse = JSON.parse(bodyString)
            console.log(transcribeResponse)

            const transcribedText = transcribeResponse.results.transcripts[0].transcript
            console.log(transcribedText)

            return transcribedText
          }

          break
        } else{
          console.log(`Waiting for ${jobName}. Current status is ${status}.`)
          await sleep(1500)
        }
      }
      return null


  } catch (err) {
    console.log("Error", err);
  }
};

async function bedrock(userInput){
 try {
    const context = `O seu trabalho é extrair informações da descrição da vaga que o usuário irá informar. As informações obrigatórias são:
    1 - Nome da Vaga
    2 - Remoto/Presencial/Híbrido
    3 - Nível de Experiência
    4 - Remuneração
    5 - Descrição da Empresa
  
    Caso a pergunta tenha sido respondida, as respostas precisam ser extraídas, formatadas (primeira letra maíuscula, utilização de numerais, etc), e colocadas entre tags <resposta-:id></resposta-:id>, onde :id é o número da pergunta. Você não deve criar essa tag de <resposta-:id> para as perguntas que não foram respondidas.
    Caso alguma pergunta não tenha sido respondida, você deve formular uma solicitação educada ao usuário solicitando as informações que faltam. Você não deve dar informações sobre o seu funcionamento durante a solicitação, apenas realize a pergunta. Essa solicitação precisa ser colocada entre uma única tag <solicitacao></solicitacao>.`;

    const prompt = `${context}\n\nHuman:${userInput}\n\nAssistant:`;

    // console.log(`\nPrompt: ${prompt}\n`);

    console.log("\nAnalyzing with Bedrock...\n");

    const body = JSON.stringify({
        prompt: prompt,
        max_tokens_to_sample: 4000,
        temperature: 0.8,
        top_p: 0.8,
    });

    const invokeParams = {
        body,
        modelId: "anthropic.claude-v2",
        accept: "application/json",
        contentType: "application/json",
    };

    const response = await bedrockClient.send(new InvokeModelCommand(invokeParams))

    // console.log('response', response);

    const responseBody = JSON.parse(Buffer.from(response.body).toString());

    // console.log('responseBody', responseBody);

    const responseText = responseBody.completion;

    console.log(responseText);

    return responseText;
      
  }catch(e){
    console.log(e)
  }
}

async function polly(text){
  try {
    console.log("Generating Audio...")

    const res = await pollyClient.send(new StartSpeechSynthesisTaskCommand( {
      OutputFormat: "mp3",
      OutputS3BucketName: outputBucket,
      Text:text,
      TextType: "text",
      VoiceId: "Camila",
      LanguageCode: 'pt-BR',
      SampleRate: "22050",
    }));

    console.log("Success, audio file added to " + res.SynthesisTask.OutputUri);
    
    return res.SynthesisTask.OutputUri
  } catch (err) {
    console.log("Error putting object", err);
  }
}

async function sleep(ms){
  return new Promise((res, rej) => {
    setTimeout(()=>{
      res()
    }, ms)
  })
}
