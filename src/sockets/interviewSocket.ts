import { Server, Socket } from 'socket.io';

const initializeSocket = (io: Server) => {
  io.on('connection', (socket: Socket) => {
    console.log(`A user connected: ${socket.id}`);

    socket.on('join-room', (interviewId: string) => {
      socket.join(interviewId);
      console.log(`User ${socket.id} joined interview room: ${interviewId}`);
    });

    socket.on('interview:started', (interviewId: string) => {
      console.log(`Interview started in room: ${interviewId}`);
      io.to(interviewId).emit('interview:started', { message: 'The interview has begun!' });
    });


    socket.on('question:asked', (data: { interviewId: string, questionId: string }) => {
      console.log(`Question ${data.questionId} asked in room: ${data.interviewId}`);
      io.to(data.interviewId).emit('question:asked', data);
    });

    socket.on('answer:saved', (data: { interviewId: string, questionId: string }) => {
      console.log(`Answer saved for question ${data.questionId} in room: ${data.interviewId}`);
      io.to(data.interviewId).emit('answer:saved', data);
    });

    socket.on('interview:completed', (interviewId: string) => {
      console.log(`Interview completed in room: ${interviewId}`);
      io.to(interviewId).emit('interview:completed', { message: 'Generating Feedback now...' });
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });
};

export default initializeSocket;