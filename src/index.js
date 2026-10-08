import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./lib/prisma.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", async (req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({ status: "ok", database: "connected" });
  console.log(`Connected to database`);
});

//fetch all forms
app.get("/forms", async (req, res, next) => {
  try {
    const forms = await prisma.form.findMany({
      orderBy: { createdAt:'desc'},
      include: {
        _count: {
          select: { questions: true, responses: true }
        }
      }
    });
    res.json(forms);
  } catch (error) {
    next(error);
  }
});

//Fetch a single form by ID
app.get("/forms/:id", async (req, res, next) =>{
  try{
    const form = await prisma.form.findUnique({
      where: {id:req.params.id},
      include: {
        questions:{
          orderBy: {order:'asc'},
          include:{
            options:true
          }
        }
      }
    });

    if(!form) return res.status(404).json({error:"Form not found"});
    res.json(form);
  } catch (error) {
    next(error);
  }
});

//creating a new form
app.post("/forms", async (req, res, next) => {
  try {
    const { title, description,questions = [] } = req.body;
    if(!title){
      return res.status(400).json({error:"Title is required"});
    }

    const form = await prisma.form.create({
      data: {
        title,
        description,
        isPublished: true,
        questions: {
          create: questions.map((q, index) => ({
            text: q.text,
            type:q.type,
            required: q.required? true: false,
            order:index,
            //optional options
            options: {
              create: (q.options || []).map(opt => ({
                text: opt.text
              }))
            }
          }))
        }
      },
      include: {
        questions: {include: {options:true}}
      },
    });
    res.status(201).json(form);
  }catch (error) {
    next(error);
  }
});

//submit form answers
app.post("/forms/:id/responses", async (req, res, next) => {
  try {
    const {id} = req.params;
    const { answers } = req.body;

    const response = await prisma.response.create({
      data:{
        formId: id,
        answers: {
          create: answers.map(answer => ({
            questionId: ans.questionId,
            value: string(ans.value)
          }))
        }
      }
    });

    res.status(201).json({message: "Response submitted successfully", response});
  } catch (error) {
    next(error);
  } 
})

//global error handler
app.use((err, req, res, next) => {
  console.error("API Error", err.message);
  res.status(500).json({error: "Internal Server Error"});
})

export default app;
